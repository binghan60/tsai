import puppeteer from 'puppeteer';
import { pdfAccessSecret } from '../config/pdfAccess.js';

// 見 CLAUDE.md「PDF 產生方式」：不維護獨立版型，直接截圖公開的報告檢視頁
export async function renderReportPdf(shareToken) {
  const browser = await puppeteer.launch();
  try {
    const page = await browser.newPage();
    const url = `${process.env.CLIENT_ORIGIN}/report/${shareToken}?renderKey=${encodeURIComponent(pdfAccessSecret)}`;
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
