import crypto from 'crypto';
import { PDFDocument } from '@cantoo/pdf-lib';

// Puppeteer 產不出加密的 PDF，所以存在 GridFS 的那份是沒有密碼的原檔，
// 要交出去（下載、Email 附件）的那一刻才加密。密碼因此永遠是飼主「現在」的手機後 6 碼，
// 改電話不必重產 PDF。沒有密碼（空字串）就原檔交出。
export async function encryptPdf(pdfBuffer, password) {
  if (!password) return pdfBuffer;
  const document = await PDFDocument.load(pdfBuffer);
  document.encrypt({
    userPassword: password,
    // 擁有者密碼用不到，但不能跟開啟密碼相同或留空——那等於任何人都能解除限制。
    ownerPassword: crypto.randomUUID(),
    permissions: { printing: 'highResolution', copying: true },
  });
  return Buffer.from(await document.save());
}
