import crypto from 'crypto';
import { PDFDocument } from '@cantoo/pdf-lib';

// Puppeteer 產不出加密的 PDF，所以存在 GridFS 的那份是沒有密碼的原檔，
// 要交出去（下載、Email 附件）的那一刻才加密。密碼因此永遠是飼主「現在」的手機後 6 碼，
// 改電話不必重產 PDF。沒有密碼（空字串）就原檔交出。
export async function encryptPdf(pdfBuffer, password) {
  if (!password) return pdfBuffer;
  const startedAt = Date.now();
  const document = await PDFDocument.load(pdfBuffer);
  document.encrypt({
    userPassword: password,
    // 擁有者密碼用不到，但不能跟開啟密碼相同或留空——那等於任何人都能解除限制。
    ownerPassword: crypto.randomUUID(),
    permissions: { printing: 'highResolution', copying: true },
  });
  const encrypted = Buffer.from(await document.save());
  // 跟 [pdf]、[mail] 兩行對照：下載與寄信各花在加密上多久。純 JS 的 pdf-lib 在 1 CPU 上會比本機慢，
  // 它邊做邊讓出事件迴圈，不會卡住別的請求，只是這一次下載／寄信要多等；真的慢到不能接受再考慮預先加密或改用 qpdf。
  console.info(`[pdf] 加密 ${Date.now() - startedAt} ms（${Math.round(pdfBuffer.length / 1024)} KB）`);
  return encrypted;
}
