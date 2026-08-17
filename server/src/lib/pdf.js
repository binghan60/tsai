import puppeteer from 'puppeteer';
import { pdfAccessSecret } from '../config/pdfAccess.js';

// 見 CLAUDE.md「PDF 產生方式」：不維護獨立版型，直接截圖公開的報告檢視頁
export async function renderReportPdf(shareToken) {
  const port = process.env.PORT || 3000;
  // 正式環境是單一容器：Express 同時提供 API 與前端靜態檔，從容器內部連自己最快。
  // 開發時 Express 不掛前端（見 app.js 的 NODE_ENV 判斷），/report 只有 Vite dev server 有，
  // 連自己只會截到 Express 的 404 頁，所以退到 CLIENT_ORIGIN。
  const localOrigin = `http://127.0.0.1:${port}`;
  const defaultOrigin = process.env.NODE_ENV === 'production'
    ? localOrigin
    : process.env.CLIENT_ORIGIN || localOrigin;
  const renderBaseUrl = (process.env.PDF_RENDER_BASE_URL || defaultOrigin).replace(/\/$/, '');
  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: process.env.PUPPETEER_NO_SANDBOX === 'true' ? ['--no-sandbox', '--disable-setuid-sandbox'] : undefined,
  });
  try {
    const page = await browser.newPage();
    await page.emulateTimezone('Asia/Taipei');
    const url = `${renderBaseUrl}/report/${shareToken}?renderKey=${encodeURIComponent(pdfAccessSecret)}`;
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
    await browser.close();
  }
}
