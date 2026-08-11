import crypto from 'crypto';

// 未額外設定時，每次伺服器啟動都使用新的內部金鑰，只供 Puppeteer 產生 PDF。
export const pdfAccessSecret = process.env.PDF_RENDER_SECRET || crypto.randomUUID();
