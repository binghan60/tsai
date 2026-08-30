import mongoose from 'mongoose';
import MedicalRecord from '../models/MedicalRecord.js';
import { renderReportPdf } from './pdf.js';

const PDF_BUCKET = 'reportPdfs';
const STALE_GENERATING_MS = 10 * 60 * 1000;
let workerPromise = null;

function bucket() {
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: PDF_BUCKET });
}

function uploadPdf(recordId, pdfBuffer) {
  return new Promise((resolve, reject) => {
    const stream = bucket().openUploadStream(`${recordId}.pdf`, {
      contentType: 'application/pdf',
      metadata: { recordId: String(recordId) },
    });
    stream.once('error', reject);
    stream.once('finish', () => resolve(stream.id));
    stream.end(pdfBuffer);
  });
}

async function removePdf(fileId) {
  if (!fileId) return;
  await bucket().delete(fileId).catch(() => {});
}

export async function streamStoredPdf(record, response) {
  if (!record.pdfFileId) return false;
  const stream = bucket().openDownloadStream(record.pdfFileId);
  await new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.once('end', resolve);
    stream.pipe(response);
  });
  return true;
}

export async function readStoredPdf(record) {
  if (!record.pdfFileId) return null;
  const chunks = [];
  const stream = bucket().openDownloadStream(record.pdfFileId);
  await new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return Buffer.concat(chunks);
}

async function claimNextJob() {
  const staleBefore = new Date(Date.now() - STALE_GENERATING_MS);
  return MedicalRecord.findOneAndUpdate(
    {
      status: 'finalized',
      $or: [
        { pdfStatus: 'pending' },
        { pdfStatus: 'generating', pdfAttemptedAt: { $lte: staleBefore } },
        // Reports created before background PDF jobs are backfilled lazily by
        // the same worker, so old downloads continue to work after deployment.
        { pdfStatus: { $exists: false } },
      ],
    },
    { $set: { pdfStatus: 'generating', pdfError: '', pdfAttemptedAt: new Date() } },
    { new: true }
  ).select('+pdfFileId');
}

async function processNextJob() {
  const record = await claimNextJob();
  if (!record) return false;
  let uploadedFileId = null;
  try {
    const pdfBuffer = await renderReportPdf(record.shareToken);
    uploadedFileId = await uploadPdf(record._id, pdfBuffer);
    const saved = await MedicalRecord.findOneAndUpdate(
      { _id: record._id, pdfStatus: 'generating' },
      {
        $set: {
          pdfStatus: 'ready',
          pdfError: '',
          pdfFileId: uploadedFileId,
          pdfGeneratedAt: new Date(),
        },
      },
      { new: true }
    ).select('+pdfFileId');
    if (!saved) {
      await removePdf(uploadedFileId);
      return true;
    }
    if (record.pdfFileId && String(record.pdfFileId) !== String(uploadedFileId)) await removePdf(record.pdfFileId);
  } catch (error) {
    await removePdf(uploadedFileId);
    await MedicalRecord.updateOne(
      { _id: record._id, pdfStatus: 'generating' },
      { $set: { pdfStatus: 'failed', pdfError: 'PDF 產生失敗，請重試。' } }
    );
    console.error('[pdf-job] report PDF generation failed', record._id, error);
  }
  return true;
}

export function runPdfJobs() {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    while (await processNextJob()) {
      // renderReportPdf already serializes Chromium work; continue until empty.
    }
  })().finally(() => {
    workerPromise = null;
  });
  return workerPromise;
}

export function enqueueReportPdf() {
  void runPdfJobs().catch((error) => console.error('[pdf-job] worker stopped unexpectedly', error));
}

export async function resumePdfJobs() {
  await MedicalRecord.updateMany(
    { status: 'finalized', pdfStatus: 'generating', pdfAttemptedAt: { $lte: new Date(Date.now() - STALE_GENERATING_MS) } },
    { $set: { pdfStatus: 'pending', pdfError: '' } }
  );
  enqueueReportPdf();
}
