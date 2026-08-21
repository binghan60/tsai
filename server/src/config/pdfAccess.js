import crypto from 'crypto';

// 未額外設定時，每次伺服器啟動都使用新的內部金鑰，只供 Puppeteer 產生 PDF。
export const pdfAccessSecret = process.env.PDF_RENDER_SECRET || crypto.randomUUID();

// Keep the renderer credential out of URLs so proxies, browser history and access logs do not retain it.
export function hasPdfRenderAccess(req) {
  const supplied = req.get('x-pdf-render-secret');
  if (!supplied) return false;
  const expectedBuffer = Buffer.from(pdfAccessSecret);
  const suppliedBuffer = Buffer.from(supplied);
  return suppliedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
}
