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
    const records = await MedicalRecord.find({ petId: req.params.petId }).sort({ visitDate: -1 });
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
    res.json(record);
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
    if (record.status !== 'sent') return res.status(409).json({ message: '請先完成 Email 寄送，再建立分享連結' });

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
  try {
    const record = await MedicalRecord.findById(req.params.id).populate({
      path: 'petId',
      populate: { path: 'ownerId', select: 'name email' },
    });
    if (!record) return res.status(404).json({ message: '找不到報告' });
    if (record.status === 'draft') {
      const missing = validateFinalRecord(record);
      if (missing.length) {
        return res.status(422).json({ message: `請先補齊：${missing.join('、')}` });
      }
    }

    const pet = record.petId;
    const owner = pet?.ownerId;
    const recipient = owner?.email?.trim();
    if (!recipient) return res.status(422).json({ message: '這位飼主尚未填寫 Email，請先補齊飼主資料' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      return res.status(422).json({ message: '飼主 Email 格式不正確，請先修正飼主資料' });
    }

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

    // SMTP 接受郵件後才結案、開啟分享並記錄寄送結果。
    record.shareEnabled = true;
    record.sharedAt = record.sharedAt || new Date();
    record.status = 'sent';
    record.sentAt = new Date();
    record.sentTo = recipient;
    record.emailMessageId = info.messageId;
    await record.save();
    if (record.weightKg != null) {
      try {
        await Pet.findByIdAndUpdate(pet._id, { weightKg: record.weightKg });
      } catch (petUpdateError) {
        console.error('寄送成功，但更新寵物最近體重失敗', petUpdateError);
      }
    }

    res.json({
      status: record.status,
      sentAt: record.sentAt,
      sentTo: record.sentTo,
      messageId: record.emailMessageId,
      shareUrl: reportUrl,
    });
  } catch (err) {
    if (err.code === 'MAIL_NOT_CONFIGURED') {
      return res.status(503).json({ message: err.message });
    }
    if (err.code === 'MAIL_RECIPIENT_REJECTED') {
      return res.status(422).json({ message: err.message });
    }
    if (err.code === 'EAUTH') {
      return res.status(502).json({ message: 'Gmail 驗證失敗：請確認 SMTP_EMAIL 與產生應用程式密碼的 Google 帳號相同，並重新產生應用程式密碼；報告狀態未變更' });
    }
    if (err.code === 'ETIMEDOUT') {
      return res.status(504).json({ message: '連線 Gmail 逾時，請確認網路後再試；報告狀態未變更' });
    }
    if (err.code === 'ECONNECTION') {
      return res.status(502).json({ message: '無法連線 Gmail SMTP，請確認網路或防火牆設定；報告狀態未變更' });
    }
    if (['EENVELOPE', 'EMESSAGE', 'EPROTOCOL'].includes(err.code)) {
      return res.status(502).json({ message: 'Gmail 未接受這封郵件，請稍後再試；報告狀態未變更' });
    }
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
    if (!isInternalRender && (!record.shareEnabled || record.status !== 'sent')) {
      return res.status(410).json({ message: '這份報告的分享連結已失效' });
    }

    res.json(reportPayload(record));
  } catch (err) {
    next(err);
  }
});
