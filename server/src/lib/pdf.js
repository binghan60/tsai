import puppeteer from 'puppeteer';
import { pdfAccessSecret } from '../config/pdfAccess.js';

// ── Chromium 實例重用 ──
// 原本每次產 PDF 都 launch 一個新的 Chromium、用完 close，光啟動就要一到三秒，
// 而結案／下載／寄送三支端點都是同步等它跑完才回應。實例留著重用，
// 第二次之後只要開一個新分頁，省掉整個瀏覽器的啟動成本。
//
// 代價是記憶體會被一個閒置的 Chromium 佔著，所以閒置夠久就關掉——
// 這種系統的使用節奏是「一陣子沒動，然後連續處理幾份報告」，
// 剛好是重用能拿到最多好處、又不必整天佔著記憶體的形狀。
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

let browserPromise = null;
let idleTimer = null;
// 正在進行中的渲染數。閒置計時器到期時若還有人在用就不能關，
// 不然會把別人的分頁一起帶走。
let activeRenders = 0;

function launchOptions() {
  return {
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: process.env.PUPPETEER_NO_SANDBOX === 'true' ? ['--no-sandbox', '--disable-setuid-sandbox'] : undefined,
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

// 同時只允許一個渲染。並行跑的話幾個分頁會一起搶著載入報告頁、一起打 API，
// 把 networkidle0 拖到永遠不滿足（實測並行三個會有兩個逾時失敗——這在共用實例之前
// 就是壞的，每次獨立開瀏覽器時三個全滅）。排隊讓每個都慢一點，但都會成功，
// 而且同時只有一個分頁在渲染，記憶體尖峰也跟著壓下來。
let renderQueue = Promise.resolve();

// 見 CLAUDE.md「PDF 產生方式」：不維護獨立版型，直接截圖公開的報告檢視頁
export function renderReportPdf(shareToken) {
  const result = renderQueue.then(() => renderNow(shareToken));
  // 佇列不能因為某一次渲染失敗就斷掉，所以接上去的是吞掉錯誤的版本；
  // 錯誤本身仍然由 result 回傳給呼叫端。
  renderQueue = result.catch(() => {});
  return result;
}

async function renderNow(shareToken) {
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
  try {
    // 重用實例的代價：拿到的瀏覽器可能在上一次渲染之後才死掉，而 connected 檢查
    // 跟實際開分頁之間也有空隙。失敗一次就丟掉實例重來，第二次仍失敗才是真的有問題。
    try {
      return await renderWith(await getBrowser(), url);
    } catch {
      await closeBrowser();
      return await renderWith(await getBrowser(), url);
    }
  } finally {
    activeRenders -= 1;
    if (activeRenders === 0) scheduleIdleClose();
  }
}

async function renderWith(browser, url) {
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({ 'x-pdf-render-secret': pdfAccessSecret });
    // 瀏覽器實例重用之後連 HTTP 快取也一起重用，第二次載入同一份報告會拿到 304，
    // 而 response.ok() 只認 200–299，整個渲染就這樣失敗了。
    // 報告內容隨時可能剛被改過，這裡本來也不該吃快取。
    await page.setCacheEnabled(false);
    await page.emulateTimezone('Asia/Taipei');
    const response = await page.goto(url, { waitUntil: 'networkidle0' });
    if (!response?.ok()) {
      throw new Error(`報告頁面載入失敗（HTTP ${response?.status() ?? 'unknown'}）`);
    }
    await page.waitForSelector('article');
    await page.evaluate(() => document.fonts.ready);
    const pdfBytes = await page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true });
    // Puppeteer 近期版本回傳 Uint8Array；Express 直接送出會被序列化成 JSON，
    // 必須先轉成 Node.js Buffer，下載檔才會是有效的 %PDF 文件。
    return Buffer.from(pdfBytes);
  } finally {
    // 只關分頁，瀏覽器留給下一次用。分頁不關會累積成記憶體洩漏。
    await page.close().catch(() => {});
  }
}

// 開發時 nodemon 一直重啟，不主動關掉的話 Chromium 會一個個殘留在背景。
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    closeBrowser().finally(() => process.exit(0));
  });
}
