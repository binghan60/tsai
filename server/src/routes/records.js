import { Router } from 'express';
import MedicalRecord from '../models/MedicalRecord.js';
import Pet from '../models/Pet.js';
import { renderReportPdf } from '../lib/pdf.js';
import { pdfAccessSecret } from '../config/pdfAccess.js';
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
    shareExpiresAt: record.shareExpiresAt,
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
    Object.assign(record, pickRecordFields(req.body));
    if (record.status !== 'draft') {
      record.status = 'draft';
      record.shareEnabled = false;
      record.shareExpiresAt = null;
    }
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
    if (record.status !== 'draft') return res.status(409).json({ message: '只能捨棄草稿紀錄' });
    await record.deleteOne();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

recordsRouter.post('/:id/generate-pdf', async (req, res, next) => {
  try {
    const record = await MedicalRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ message: '找不到報告' });

    const missing = validateFinalRecord(record);
    if (missing.length) {
      return res.status(422).json({ message: `請先完成：${missing.join('、')}` });
    }

    const pdfBuffer = await renderReportPdf(record.shareToken);
    record.status = 'generated';
    await record.save();
    if (record.weightKg != null) {
      await Pet.findByIdAndUpdate(record.petId, { weightKg: record.weightKg });
    }

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="report-${record._id}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

recordsRouter.post('/:id/share', async (req, res, next) => {
  try {
    const record = await MedicalRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ message: '找不到報告' });
    if (record.status === 'draft') return res.status(409).json({ message: '請先產出正式報告，再建立分享連結' });

    const days = Math.min(Math.max(Number(req.body?.days) || 30, 1), 90);
    record.shareEnabled = true;
    record.sharedAt = new Date();
    record.shareExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await record.save();

    res.json({
      url: `${process.env.CLIENT_ORIGIN}/report/${record.shareToken}`,
      expiresAt: record.shareExpiresAt,
    });
  } catch (err) {
    next(err);
  }
});

recordsRouter.post('/:id/revoke-share', async (req, res, next) => {
  try {
    const record = await MedicalRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ message: '找不到報告' });
    record.shareEnabled = false;
    record.shareExpiresAt = null;
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
    const isExpired = record.shareExpiresAt && record.shareExpiresAt.getTime() < Date.now();
    if (!isInternalRender && (!record.shareEnabled || isExpired)) {
      return res.status(410).json({ message: '這份報告的分享連結已失效' });
    }

    res.json(reportPayload(record));
  } catch (err) {
    next(err);
  }
});
