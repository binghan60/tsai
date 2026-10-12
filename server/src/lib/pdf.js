import puppeteer from 'puppeteer';
import { pdfAccessSecret } from '../config/pdfAccess.js';

// ── Chromium 實例重用 ──
// 原本每次產 PDF 都 launch 一個新的 Chromium、用完 close，光啟動就要一到三秒，
// 而結案／下載／寄送三支端點都是同步等它跑完才回應。實例留著重用，
// 第二次之後只要開一個新分頁，省掉整個瀏覽器的啟動成本。
//
// 代價是記憶體會被一個閒置的 Chromium 佔著，所以閒置夠久就關掉。
// 診所的節奏是「結案、看一下、過一陣子才寄信」，五分鐘就關會讓幾乎每次都重新啟動，
// 在 1 CPU 的機器上光啟動就要好幾秒；閒置的 Chromium 只佔一兩百 MB，留久一點划算。
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

let browserPromise = null;
let idleTimer = null;
// 正在進行中的渲染數。閒置計時器到期時若還有人在用就不能關，
// 不然會把別人的分頁一起帶走。
let activeRenders = 0;

function launchOptions() {
  // Docker 預設的 /dev/shm 只有 64MB，Chromium 拿它當共享記憶體會不夠用而崩潰，改用 /tmp；
  // 伺服器沒有 GPU，關掉省下 GPU 程序。
  const args = ['--disable-dev-shm-usage', '--disable-gpu'];
  if (process.env.PUPPETEER_NO_SANDBOX === 'true') args.push('--no-sandbox', '--disable-setuid-sandbox');
  return {
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args,
  };
}

async function getBrowser() {
  if (browserPromise) {
    // launch 失敗或瀏覽器中途崩潰（OOM、被系統殺掉）時，快取的是個沒用的實例，
    // 丟掉重開才不會讓後續每一次渲染都跟著失敗。
    const existing = await browserPromise.catch(() => null);
    if (existing?.connected) return existing;
    browserPromise = null;
  }
  // 指派的是 promise 而不是 await 後的結果：同時進來的多個請求會共用這一次啟動，
  // 不會各自開一個 Chromium。
  browserPromise = puppeteer.launch(launchOptions());
  return browserPromise;
}

function scheduleIdleClose() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (activeRenders > 0) return;
    closeBrowser().catch(() => {});
  }, IDLE_TIMEOUT_MS);
  // 只是回收閒置資源，不值得讓 Node 為了它留著不結束。
  idleTimer.unref?.();
}

export async function closeBrowser() {
  const pending = browserPromise;
  browserPromise = null;
  clearTimeout(idleTimer);
  const browser = await pending?.catch(() => null);
  await browser?.close().catch(() => {});
}

// 同時只允許一個渲染。並行跑的話幾個分頁會一起搶著載入報告頁、一起打 API
// （以前等 networkidle0 時，實測並行三個會有兩個逾時失敗），在 1 CPU 上也只是互相搶時間。
// 排隊讓每個都慢一點，但都會成功，而且同時只有一個分頁在渲染，記憶體尖峰也跟著壓下來。
let renderQueue = Promise.resolve();

// 見 CLAUDE.md「PDF 產生方式」：不維護獨立版型，直接截圖公開的報告檢視頁
export function renderReportPdf(shareToken) {
  const queuedAt = Date.now();
  const result = renderQueue.then(() => renderNow(shareToken, queuedAt));
  // 佇列不能因為某一次渲染失敗就斷掉，所以接上去的是吞掉錯誤的版本；
  // 錯誤本身仍然由 result 回傳給呼叫端。
  renderQueue = result.catch(() => {});
  return result;
}

// 每次渲染記一行分段耗時：正式機（1 CPU）上慢在哪一段，只有實際數字說得準。
// 不記 shareToken——它就是報告的分享憑證，不該留在 log 裡。
// 用累加的：第一次失敗重試時，兩次花的時間都要算進去。
function addTiming(timings, key, startedAt) {
  timings[key] = (timings[key] ?? 0) + (Date.now() - startedAt);
}

function logTimings(timings, retried) {
  const total = Object.values(timings).reduce((sum, ms) => sum + ms, 0);
  const parts = [
    ['排隊', timings.queue],
    ['啟動瀏覽器', timings.launch],
    ['載入報告頁', timings.load],
    ['字型與圖片', timings.assets],
    ['輸出 PDF', timings.pdf],
  ].map(([label, ms]) => `${label} ${ms ?? 0}`);
  console.info(`[pdf] 產生 PDF ${total} ms（${parts.join('、')}）${retried ? '，第一次失敗後重試' : ''}`);
}

async function renderNow(shareToken, queuedAt) {
  const port = process.env.PORT || 3000;
  // 正式環境是單一容器：Express 同時提供 API 與前端靜態檔，從容器內部連自己最快。
  // 開發時 Express 不掛前端（見 app.js 的 NODE_ENV 判斷），/report 只有 Vite dev server 有，
  // 連自己只會截到 Express 的 404 頁，所以退到 CLIENT_ORIGIN。
  const localOrigin = `http://127.0.0.1:${port}`;
  const defaultOrigin = process.env.NODE_ENV === 'production'
    ? localOrigin
    : process.env.CLIENT_ORIGIN || localOrigin;
  const renderBaseUrl = (process.env.PDF_RENDER_BASE_URL || defaultOrigin).replace(/\/$/, '');
  const url = `${renderBaseUrl}/report/${shareToken}`;

  clearTimeout(idleTimer);
  activeRenders += 1;
  const timings = { queue: Date.now() - queuedAt };
  const attempt = async () => {
    const launchStartedAt = Date.now();
    const browser = await getBrowser();
    addTiming(timings, 'launch', launchStartedAt);
    return renderWith(browser, url, timings);
  };
  try {
    // 重用實例的代價：拿到的瀏覽器可能在上一次渲染之後才死掉，而 connected 檢查
    // 跟實際開分頁之間也有空隙。失敗一次就丟掉實例重來，第二次仍失敗才是真的有問題。
    let pdf;
    let retried = false;
    try {
      pdf = await attempt();
    } catch {
      retried = true;
      await closeBrowser();
      pdf = await attempt();
    }
    logTimings(timings, retried);
    return pdf;
  } finally {
    activeRenders -= 1;
    if (activeRenders === 0) scheduleIdleClose();
  }
}

async function renderWith(browser, url, timings) {
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({ 'x-pdf-render-secret': pdfAccessSecret });
    // HTTP 快取保持開啟：前端 JS／CSS／字型檔名帶 hash、內容不會變，重用的瀏覽器
    // 第二次之後不必再從 Express 拉一百多個檔、重新編譯 JS。報告資料不會因此過期——
    // 報告 API 回 no-store、每次都重抓；index.html 帶 ETag、每次回伺服器確認，
    // 沒變會回 304，那也是成功（response.ok() 只認 200–299，要另外放行）。
    await page.emulateTimezone('Asia/Taipei');
    // 載入時就用列印樣式排版，下面等字型時等到的才是 PDF 上真正用到的字。
    await page.emulateMediaType('print');
    const loadStartedAt = Date.now();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (!response || !(response.ok() || response.status() === 304)) {
      throw new Error(`報告頁面載入失敗（HTTP ${response?.status() ?? 'unknown'}）`);
    }
    // 報告頁只打一支 API，資料回來那一刻 <article> 連同全部內容一起畫出來，
    // 等它出現就夠了；不用 networkidle0——它固定多等 0.5 秒，還會被任何晚到的請求拖住。
    await page.waitForSelector('article');
    addTiming(timings, 'load', loadStartedAt);

    const assetsStartedAt = Date.now();
    await page.evaluate(async () => {
      // 先強制排版：網頁字型是排版時用到哪一段字才去下載，排版之前 fonts.ready 會直接放行。
      document.body.getBoundingClientRect();
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, (image) => (image.complete ? null : new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      }))));
      await document.fonts.ready;
    });
    addTiming(timings, 'assets', assetsStartedAt);

    const pdfStartedAt = Date.now();
    const pdfBytes = await page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true });
    addTiming(timings, 'pdf', pdfStartedAt);
    // Puppeteer 近期版本回傳 Uint8Array；Express 直接送出會被序列化成 JSON，
    // 必須先轉成 Node.js Buffer，下載檔才會是有效的 %PDF 文件。
    return Buffer.from(pdfBytes);
  } finally {
    // 只關分頁，瀏覽器留給下一次用。分頁不關會累積成記憶體洩漏。
    await page.close().catch(() => {});
  }
}

// 關機時由 app.js 統一停止 HTTP、等待既有請求、關 Chromium 與 MongoDB。
// library 自己呼叫 process.exit() 會截斷還在寫回的寄送或病歷操作。
