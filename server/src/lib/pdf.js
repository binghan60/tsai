import puppeteer from 'puppeteer';
import { pdfAccessSecret } from '../config/pdfAccess.js';

// 見 CLAUDE.md「PDF 產生方式」：不維護獨立版型，直接截圖公開的報告檢視頁
export async function renderReportPdf(shareToken) {
  const browser = await puppeteer.launch();
  try {
    const page = await browser.newPage();
    const url = `${process.env.CLIENT_ORIGIN}/report/${shareToken}?renderKey=${encodeURIComponent(pdfAccessSecret)}`;
    await page.goto(url, { waitUntil: 'networkidle0' });
    return await page.pdf({ format: 'A4', printBackground: true });
  } finally {
    await browser.close();
  }
}
