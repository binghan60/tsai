import { Router } from 'express';
import MedicalRecord from '../models/MedicalRecord.js';
import Pet from '../models/Pet.js';
import { renderReportPdf } from '../lib/pdf.js';
import { assertMailConfigured, sendHealthReportEmail } from '../lib/mailer.js';
import { pdfAccessSecret } from '../config/pdfAccess.js';
import { LAB_TEST_MAP } from '../config/labTests.js';
import { v4 as uuidv4 } from 'uuid';

const RECORD_FIELDS = [
  'vet',
  'visitDate',
  'examType',
  'weightKg',
  'temperatureC',
  'heartRate',
  'respiratoryRate',
  'bodyConditionScore',
  'measurementAssessments',
  'examinationFindings',
  'labFindings',
  'labSummary',
  'chiefComplaint',
  'history',
  'diagnosis',
  'treatmentPlan',
  'conclusion',
  'other',
];

function pickRecordFields(body) {
  const data = {};
  for (const field of RECORD_FIELDS) {
    if (body[field] !== undefined) data[field] = body[field];
  }
  return data;
}

function isFinalizedRecord(record) {
  return Boolean(record && record.status !== 'draft');
}

function effectiveDeliveryStatus(record) {
  if (record?.deliveryStatus && !(record.status === 'sent' && record.deliveryStatus === 'not_sent')) {
    return record.deliveryStatus;
  }
  return record?.status === 'sent' ? 'sent' : 'not_sent';
}

function recordSnapshot(record) {
  return Object.fromEntries(RECORD_FIELDS.map((field) => [field, record[field]]));
}

function safePdfFilename(record) {
  const reportNumber = String(record.reportNumber || `HC-${record._id.toString().slice(-8).toUpperCase()}`)
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${reportNumber}.pdf`;
}

function hasClinicalContent(record) {
  return Boolean(
    record.diagnosis?.trim() ||
      record.conclusion?.trim() ||
      record.treatmentPlan?.trim() ||
      [record.weightKg, record.temperatureC, record.heartRate, record.respiratoryRate, record.bodyConditionScore].some((value) => value != null) ||
      record.examinationFindings?.some((finding) => finding.status !== 'not_checked') ||
      record.labFindings?.some((finding) => finding.status !== 'not_checked')
  );
}

function validateFinalRecord(record) {
  const missing = [];
  if (!record.vet?.trim()) missing.push('獸醫師');
  if (!record.visitDate) missing.push('健檢日期');
  if (!hasClinicalContent(record)) missing.push('基本量測、結論、診斷、理學檢查或檢驗結果');
  if (!record.conclusion?.trim() && !record.treatmentPlan?.trim()) missing.push('結論或照護與追蹤建議');

  const examinationWithoutNote = (record.examinationFindings ?? [])
    .filter((finding) => finding.status === 'abnormal' && !finding.note?.trim())
    .map((finding) => finding.label);
  if (examinationWithoutNote.length) missing.push(`理學檢查異常說明（${examinationWithoutNote.join('、')}）`);

  const labsWithoutNote = (record.labFindings ?? [])
    .filter((finding) => finding.status === 'abnormal' && !finding.note?.trim())
    .map((finding) => finding.label);
  if (labsWithoutNote.length) missing.push(`檢驗異常說明（${labsWithoutNote.join('、')}）`);

  const invalidLabValues = (record.labFindings ?? [])
    .filter((finding) => LAB_TEST_MAP.get(finding.key)?.numeric !== false && String(finding.value ?? '').trim() && !Number.isFinite(Number(finding.value)))
    .map((finding) => finding.label);
  if (invalidLabValues.length) missing.push(`檢驗數值格式（${invalidLabValues.join('、')}）`);
  return missing;
}

function reportPayload(record) {
  const pet = record.petId;
  const owner = pet?.ownerId;
  return {
    reportNumber: record.reportNumber || `HC-${record._id.toString().slice(-8).toUpperCase()}`,
    vet: record.vet,
    visitDate: record.visitDate,
    examType: record.examType,
    weightKg: record.weightKg,
    temperatureC: record.temperatureC,
    heartRate: record.heartRate,
    respiratoryRate: record.respiratoryRate,
    bodyConditionScore: record.bodyConditionScore,
    measurementAssessments: record.measurementAssessments,
    examinationFindings: record.examinationFindings,
    labFindings: record.labFindings,
    labSummary: record.labSummary,
    chiefComplaint: record.chiefComplaint,
    history: record.history,
    diagnosis: record.diagnosis,
    treatmentPlan: record.treatmentPlan,
    conclusion: record.conclusion,
    other: record.other,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    status: record.status,
    finalizedAt: record.finalizedAt,
    pdfGeneratedAt: record.pdfGeneratedAt,
    reportVersion: record.reportVersion || 1,
    revisionReason: record.revisionReason,
    hasNewerVersion: Boolean(record.supersededBy),
    deliveryStatus: effectiveDeliveryStatus(record),
    deliveryError: record.deliveryError,
    lastDeliveryAttemptAt: record.lastDeliveryAttemptAt,
    sentAt: record.sentAt,
    sentTo: record.sentTo,
    shareEnabled: record.shareEnabled,
    pet: pet
      ? {
          name: pet.name,
          medicalRecordNumber: pet.medicalRecordNumber || `PET-${pet._id.toString().slice(-8).toUpperCase()}`,
          species: pet.species,
          breed: pet.breed,
          sex: pet.sex,
          neutered: pet.neutered,
          birthDate: pet.birthDate,
          microchipNumber: pet.microchipNumber,
          allergies: pet.allergies,
          chronicConditions: pet.chronicConditions,
          currentMedications: pet.currentMedications,
        }
      : null,
    owner: owner ? { name: owner.name } : null,
  };
}

// 掛載於 /api/pets/:petId/records
export const petRecordsRouter = Router({ mergeParams: true });

petRecordsRouter.get('/', async (req, res, next) => {
  try {
    const records = await MedicalRecord.find({ petId: req.params.petId }).sort({ visitDate: -1, reportVersion: -1, updatedAt: -1 });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

petRecordsRouter.post('/', async (req, res, next) => {
  try {
    const pet = await Pet.findById(req.params.petId);
    if (!pet) return res.status(404).json({ message: '找不到寵物' });
    const record = await MedicalRecord.create({ petId: req.params.petId, ...pickRecordFields(req.body) });
    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
});

// 掛載於 /api/records
export const recordsRouter = Router();

recordsRouter.get('/:id', async (req, res, next) => {
  try {
    const record = await MedicalRecord.findById(req.params.id).populate({
      path: 'petId',
      populate: { path: 'ownerId', select: 'name phone email' },
    });
    if (!record) return res.status(404).json({ message: '找不到報告' });
    res.json({ ...record.toObject(), deliveryStatus: effectiveDeliveryStatus(record) });
  } catch (err) {
    next(err);
  }
});

recordsRouter.put('/:id', async (req, res, next) => {
  try {
    const record = await MedicalRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ message: '找不到報告' });
    if (record.status !== 'draft') {
      return res.status(409).json({ message: '這份報告已結案，無法直接修改，請建立修訂草稿' });
    }
    Object.assign(record, pickRecordFields(req.body));
    await record.save();
    res.json(record);
  } catch (err) {
    next(err);
  }
});

recordsRouter.post('/:id/finalize', async (req, res, next) => {
  let record;
  try {
    record = await MedicalRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ message: '找不到報告' });
    if (isFinalizedRecord(record)) {
      return res.json({
        status: 'finalized',
        finalizedAt: record.finalizedAt,
        pdfGeneratedAt: record.pdfGeneratedAt,
        reportVersion: record.reportVersion || 1,
        deliveryStatus: effectiveDeliveryStatus(record),
      });
    }

    const missing = validateFinalRecord(record);
    if (missing.length) {
      return res.status(422).json({ message: `請先補齊：${missing.join('、')}` });
    }

    const previousFinalizedAt = record.finalizedAt;
    const previousPdfGeneratedAt = record.pdfGeneratedAt;
    record.status = 'finalized';
    record.finalizedAt = new Date();
    record.deliveryStatus = 'not_sent';
    record.deliveryError = '';
    await record.save();

    try {
      await renderReportPdf(record.shareToken);
    } catch (pdfError) {
      record.status = 'draft';
      record.finalizedAt = previousFinalizedAt;
      record.pdfGeneratedAt = previousPdfGeneratedAt;
      await record.save();
      pdfError.isFinalizePdfError = true;
      throw pdfError;
    }

    record.pdfGeneratedAt = new Date();
    await record.save();
    if (record.revisionOf) {
      await MedicalRecord.findByIdAndUpdate(record.revisionOf, { supersededBy: record._id });
    }
    if (record.weightKg != null) {
      try {
        await Pet.findByIdAndUpdate(record.petId, { weightKg: record.weightKg });
      } catch (petUpdateError) {
        console.error('報告已結案，但更新寵物最近體重失敗', petUpdateError);
      }
    }

    res.json({
      status: 'finalized',
      finalizedAt: record.finalizedAt,
      pdfGeneratedAt: record.pdfGeneratedAt,
      reportVersion: record.reportVersion || 1,
      deliveryStatus: effectiveDeliveryStatus(record),
    });
  } catch (err) {
    if (err.isFinalizePdfError) {
      return res.status(502).json({ message: 'PDF 產生失敗，報告仍維持草稿，請稍後再試' });
    }
    next(err);
  }
});

recordsRouter.get('/:id/pdf', async (req, res, next) => {
  try {
    const record = await MedicalRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ message: '找不到報告' });
    if (!isFinalizedRecord(record)) {
      return res.status(409).json({ message: '請先結案，再下載正式 PDF' });
    }
    const pdfBuffer = await renderReportPdf(record.shareToken);
    record.pdfGeneratedAt = new Date();
    await record.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safePdfFilename(record)}"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

recordsRouter.post('/:id/revisions', async (req, res, next) => {
  try {
    const source = await MedicalRecord.findById(req.params.id);
    if (!source) return res.status(404).json({ message: '找不到報告' });
    if (!isFinalizedRecord(source)) {
      return res.status(409).json({ message: '草稿可直接編輯，不需要建立修訂版' });
    }
    if (source.supersededBy) {
      return res.status(409).json({
        message: '這份報告已有後續修訂版本',
        newerRecordId: source.supersededBy,
      });
    }

    const existingDraft = await MedicalRecord.findOne({ revisionOf: source._id, status: 'draft' });
    if (existingDraft) {
      return res.status(409).json({
        message: '這份報告已有待完成的修訂草稿',
        revisionId: existingDraft._id,
      });
    }

    const rootId = source.revisionRootId || source._id;
    const latestVersion = await MedicalRecord.findOne({
      $or: [{ _id: rootId }, { revisionRootId: rootId }],
    }).sort({ reportVersion: -1 }).select('reportVersion');
    const reportVersion = Math.max(latestVersion?.reportVersion || 1, source.reportVersion || 1) + 1;
    const revision = await MedicalRecord.create({
      petId: source.petId,
      ...recordSnapshot(source),
      status: 'draft',
      reportVersion,
      revisionOf: source._id,
      revisionRootId: rootId,
      revisionReason: String(req.body.reason || '').trim(),
      finalizedAt: null,
      pdfGeneratedAt: null,
      deliveryStatus: 'not_sent',
      deliveryError: '',
      lastDeliveryAttemptAt: null,
      shareEnabled: false,
      sharedAt: null,
      sentAt: undefined,
      sentTo: undefined,
      emailMessageId: undefined,
    });

    res.status(201).json(revision);
  } catch (err) {
    next(err);
  }
});

recordsRouter.delete('/:id', async (req, res, next) => {
  try {
    const record = await MedicalRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ message: '找不到報告' });
    if (record.status !== 'draft') {
      return res.status(409).json({ message: '已結案的報告不能刪除' });
    }
    await record.deleteOne();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

recordsRouter.post('/:id/share', async (req, res, next) => {
  try {
    const record = await MedicalRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ message: '找不到報告' });
    if (!isFinalizedRecord(record)) return res.status(409).json({ message: '請先結案，再建立分享連結' });

    record.shareEnabled = true;
    record.sharedAt = new Date();
    await record.save();

    res.json({
      url: `${process.env.CLIENT_ORIGIN}/report/${record.shareToken}`,
    });
  } catch (err) {
    next(err);
  }
});

recordsRouter.post('/:id/send-email', async (req, res, next) => {
  let record;
  try {
    record = await MedicalRecord.findById(req.params.id).populate({
      path: 'petId',
      populate: { path: 'ownerId', select: 'name email' },
    });
    if (!record) return res.status(404).json({ message: '找不到報告' });
    if (!isFinalizedRecord(record)) {
      return res.status(409).json({ message: '請先完成結案，再寄送正式報告' });
    }
    const sendingRecently = effectiveDeliveryStatus(record) === 'sending'
      && record.lastDeliveryAttemptAt
      && Date.now() - new Date(record.lastDeliveryAttemptAt).getTime() < 10 * 60 * 1000;
    if (sendingRecently) {
      return res.status(409).json({ message: '報告正在寄送中，請勿重複操作' });
    }

    const pet = record.petId;
    const owner = pet?.ownerId;
    const recipient = owner?.email?.trim();
    if (!recipient) return res.status(422).json({ message: '這位飼主尚未填寫 Email，請先補齊飼主資料' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      return res.status(422).json({ message: '飼主 Email 格式不正確，請先修正飼主資料' });
    }

    record.status = 'finalized';
    record.deliveryStatus = 'sending';
    record.deliveryError = '';
    record.lastDeliveryAttemptAt = new Date();
    await record.save();

    assertMailConfigured();
    const pdfBuffer = await renderReportPdf(record.shareToken);
    const reportUrl = `${process.env.CLIENT_ORIGIN}/report/${record.shareToken}`;
    const info = await sendHealthReportEmail({
      to: recipient,
      ownerName: owner.name,
      petName: pet.name,
      reportNumber: record.reportNumber,
      reportUrl,
      pdfBuffer,
    });

    // SMTP 接受郵件後只更新寄送狀態；報告的結案狀態不依賴 Email。
    record.shareEnabled = true;
    record.sharedAt = record.sharedAt || new Date();
    record.status = 'finalized';
    record.deliveryStatus = 'sent';
    record.deliveryError = '';
    record.pdfGeneratedAt = new Date();
    record.sentAt = new Date();
    record.sentTo = recipient;
    record.emailMessageId = info.messageId;
    await record.save();

    res.json({
      status: 'finalized',
      deliveryStatus: record.deliveryStatus,
      sentAt: record.sentAt,
      sentTo: record.sentTo,
      messageId: record.emailMessageId,
      shareUrl: reportUrl,
    });
  } catch (err) {
    let response;
    if (err.code === 'MAIL_NOT_CONFIGURED') response = { status: 503, message: err.message };
    else if (err.code === 'MAIL_RECIPIENT_REJECTED') response = { status: 422, message: err.message };
    else if (err.code === 'EAUTH') response = { status: 502, message: 'Gmail 驗證失敗，請確認寄信設定後再試；報告已結案，不受影響' };
    else if (err.code === 'ETIMEDOUT') response = { status: 504, message: '連線 Gmail 逾時，請確認網路後再試；報告已結案，不受影響' };
    else if (err.code === 'ECONNECTION') response = { status: 502, message: '無法連線 Gmail SMTP，請確認網路或防火牆設定；報告已結案，不受影響' };
    else if (['EENVELOPE', 'EMESSAGE', 'EPROTOCOL'].includes(err.code)) response = { status: 502, message: 'Gmail 未接受這封郵件，請稍後再試；報告已結案，不受影響' };

    if (record && isFinalizedRecord(record) && record.deliveryStatus === 'sending') {
      record.deliveryStatus = 'failed';
      record.deliveryError = response?.message || '寄送失敗，請稍後重試';
      try {
        await record.save();
      } catch (saveError) {
        console.error('記錄寄送失敗狀態時發生錯誤', saveError);
      }
    }
    if (response) return res.status(response.status).json({ message: response.message });
    next(err);
  }
});

recordsRouter.post('/:id/revoke-share', async (req, res, next) => {
  try {
    const record = await MedicalRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ message: '找不到報告' });
    record.shareEnabled = false;
    record.shareToken = uuidv4();
    await record.save();
    res.json({ message: '分享連結已撤銷' });
  } catch (err) {
    next(err);
  }
});

// 掛載於 /api/public/reports（公開路由，無需登入）
export const publicReportsRouter = Router();

publicReportsRouter.get('/:token', async (req, res, next) => {
  try {
    const record = await MedicalRecord.findOne({ shareToken: req.params.token }).populate({
      path: 'petId',
      populate: { path: 'ownerId', select: 'name' },
    });
    if (!record) return res.status(404).json({ message: '找不到這份報告，連結可能已失效' });

    const isInternalRender = req.query.renderKey && req.query.renderKey === pdfAccessSecret;
    if (!isInternalRender && (!record.shareEnabled || !isFinalizedRecord(record))) {
      return res.status(410).json({ message: '這份報告的分享連結已失效' });
    }

    res.json(reportPayload(record));
  } catch (err) {
    next(err);
  }
});
