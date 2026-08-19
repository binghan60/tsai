import { Router } from 'express';
import mongoose from 'mongoose';
import FormTemplate from '../models/FormTemplate.js';
import MedicalRecord from '../models/MedicalRecord.js';
import Pet from '../models/Pet.js';
import { renderReportPdf } from '../lib/pdf.js';
import { assertMailConfigured, sendHealthReportEmail } from '../lib/mailer.js';
import { pdfAccessSecret } from '../config/pdfAccess.js';
import { templateForRecord } from '../lib/formTemplate.js';
import { composeReportSections } from '../lib/reportSections.js';
import { v4 as uuidv4 } from 'uuid';

// examType 不在這裡 —— 它等同於「用哪一份範本」，只在建立報告時決定，
// 之後不能透過一般更新改動，否則已填的作答會對不上表單結構。
const RECORD_FIELDS = [
  'vet',
  'visitDate',
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
  // 使用者自訂項目的作答
  'customValues',
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
  return record?.deliveryStatus ?? 'not_sent';
}

function recordSnapshot(record) {
  return Object.fromEntries(RECORD_FIELDS.map((field) => [field, record[field]]));
}

function safePdfFilename(record) {
  const reportNumber = String(record.reportNumber || `HC-${record._id.toString().slice(-8).toUpperCase()}`)
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${reportNumber}.pdf`;
}

function publicAppOrigin(req) {
  const configuredOrigin = process.env.PUBLIC_APP_URL || process.env.CLIENT_ORIGIN || process.env.ZEABUR_WEB_URL;
  if (configuredOrigin) return configuredOrigin.replace(/\/$/, '');

  const forwardedProtocol = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim();
  const protocol = forwardedProtocol || req.protocol;
  const host = forwardedHost || req.get('host');
  return `${protocol}://${host}`;
}

// 「這份報告有沒有臨床內容」改由範本決定：只要任何一個非固定預設的項目有填就算。
// visitDate 有預設值、vet 是行政欄位，都不能當作「有臨床內容」的訊號。
const PREFILLED_ROLES = new Set(['visitDate', 'vet']);

// 「這個項目有沒有作答」的唯一判準，臨床內容檢查與必填檢查共用同一份 ——
// 兩邊各寫一份遲早會分岔成「前端放行、後端 422」。與前端 validateForPreview() 對齊：
// finding 看有沒有標記過檢查結果（它沒有 value，看 value 會永遠不滿足）；
// lab 是標記過或填了數值都算，「按了正常但沒填數值」也是有作答。
function itemHasAnswer(item) {
  if (item.type === 'finding') return item.status !== 'not_checked';
  if (item.type === 'lab') return item.status !== 'not_checked' || String(item.value ?? '').trim() !== '';
  return item.value !== null && item.value !== undefined && String(item.value).trim() !== '';
}

function hasClinicalContent(sections) {
  return sections.some((section) =>
    (section.items ?? []).some((item) => !PREFILLED_ROLES.has(item.role) && itemHasAnswer(item))
  );
}

// 結案前的完整性檢查全部改看範本組出來的 sections，
// 使用者改欄位名稱、搬動位置或新增自訂項目都會自動納入。
function validateFinalRecord(sections) {
  const missing = [];
  const items = sections.flatMap((section) => section.items ?? []);
  const byRole = (role) => items.find((item) => item.role === role);
  const filled = (item) => item && String(item.value ?? '').trim();

  for (const item of items.filter((entry) => entry.required)) {
    if (!itemHasAnswer(item)) missing.push(item.label);
  }

  if (!hasClinicalContent(sections)) missing.push('基本量測、結論、診斷、理學檢查或檢驗結果');

  // 結論與照護建議至少要有一項；兩個欄位都被停用時就不檢查。
  const conclusion = byRole('conclusion');
  const treatmentPlan = byRole('treatmentPlan');
  if ((conclusion || treatmentPlan) && !filled(conclusion) && !filled(treatmentPlan)) {
    missing.push([conclusion?.label, treatmentPlan?.label].filter(Boolean).join('或'));
  }

  const abnormalWithoutNote = items
    .filter((item) => (item.type === 'finding' || item.type === 'lab') && item.status === 'abnormal' && !item.note?.trim())
    .map((item) => item.label);
  if (abnormalWithoutNote.length) missing.push(`異常說明（${abnormalWithoutNote.join('、')}）`);

  const invalidLabValues = items
    .filter((item) => item.type === 'lab' && item.numeric !== false && String(item.value ?? '').trim() && !Number.isFinite(Number(item.value)))
    .map((item) => item.label);
  if (invalidLabValues.length) missing.push(`檢驗數值格式（${invalidLabValues.join('、')}）`);
  return missing;
}

function reportPayload(record, sections) {
  const pet = record.petId;
  const owner = pet?.ownerId;
  return {
    // 臨床內容一律走這份區塊快照；報告頁不再讀 MedicalRecord 的具名欄位。
    sections,
    reportNumber: record.reportNumber || `HC-${record._id.toString().slice(-8).toUpperCase()}`,
    examType: record.examType,
    visitDate: record.visitDate,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    status: record.status,
    finalizedAt: record.finalizedAt,
    pdfGeneratedAt: record.pdfGeneratedAt,
    reportVersion: record.reportVersion || 1,
    revisionReason: record.revisionReason,
    hasNewerVersion: Boolean(record.supersededBy),
    // 這份 payload 只給公開分享連結使用，寄送作業的內部欄位
    //（deliveryError／lastDeliveryAttemptAt／sentTo）不對飼主外露。
    deliveryStatus: effectiveDeliveryStatus(record),
    sentAt: record.sentAt,
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

// ── 填表時的「上次數值」──
// 這隻寵物過去每個項目最近一次的紀錄，不限健檢類型：只要以前量過血小板，
// 這次的表單有血小板就能顯示上次的值，即使兩次用的是不同的健檢表單。
// 只收得出數值的型別 —— 理學檢查只有正常／異常，沒有可以拿來對照的數字。
const HISTORY_ITEM_TYPES = new Set(['lab', 'measurement', 'number']);
// 逐份走訪已結案報告找「每個項目最近一次」的值。太久以前的紀錄拿來對照的意義有限，
// 也不該讓填表頁為了翻完全部病歷而多等，只看最近這幾份。
const HISTORY_RECORD_LIMIT = 20;

function historyEntry(record, item) {
  return {
    key: item.key,
    label: item.label,
    type: item.type,
    value: item.value,
    unit: item.unit ?? '',
    status: item.status ?? null,
    note: item.note ?? '',
    visitDate: record.visitDate,
    examType: record.examType,
    recordId: record._id,
  };
}

// 正在填的這份報告與它的其他版本都不算「上次」——
// 修訂草稿要對照的是更早的那次健檢，不是自己的前一版。
async function excludedHistoryIds(recordId) {
  if (!recordId || !mongoose.isValidObjectId(recordId)) return [];
  const current = await MedicalRecord.findById(recordId).select('revisionRootId revisionOf');
  const rootId = current?.revisionRootId || current?.revisionOf;
  if (!rootId) return [recordId];
  const family = await MedicalRecord.find({ $or: [{ _id: rootId }, { revisionRootId: rootId }] }).select('_id');
  return [recordId, ...family.map((doc) => doc._id)];
}

petRecordsRouter.get('/previous-values', async (req, res, next) => {
  try {
    const records = await MedicalRecord.find({
      petId: req.params.petId,
      // 草稿還沒定稿，不能拿來當歷史數值；
      // 已被修訂版取代的舊版也不算，同一次健檢只看最後定稿的內容。
      status: { $ne: 'draft' },
      supersededBy: null,
      _id: { $nin: await excludedHistoryIds(req.query.excludeRecordId) },
    })
      .sort({ visitDate: -1, finalizedAt: -1, reportVersion: -1 })
      .limit(HISTORY_RECORD_LIMIT)
      .select('sections visitDate examType');

    const byKey = {};
    const byLabel = {};
    // 由新到舊走訪，每個項目只留第一次遇到的（也就是最近一次的）紀錄。
    for (const record of records) {
      // 已結案報告一定有 sections 快照，不必回頭組範本。
      for (const item of (record.sections ?? []).flatMap((section) => section.items ?? [])) {
        // 只按了「正常」卻沒填數值的項目留不下可比較的東西，不列入。
        if (!HISTORY_ITEM_TYPES.has(item.type) || String(item.value ?? '').trim() === '') continue;
        const entry = historyEntry(record, item);
        if (!byKey[item.key]) byKey[item.key] = entry;
        // 自訂項目的 key 是各表單各自產生的，跨類型對不起來；
        // 同型別又同名稱的項目視為同一件事，換一種健檢也才看得到上次的值。
        const labelKey = `${item.type}:${String(item.label ?? '').trim()}`;
        if (!byLabel[labelKey]) byLabel[labelKey] = entry;
      }
    }
    res.json({ byKey, byLabel });
  } catch (err) {
    next(err);
  }
});

petRecordsRouter.post('/', async (req, res, next) => {
  try {
    const pet = await Pet.findById(req.params.petId);
    if (!pet) return res.status(404).json({ message: '找不到寵物' });

    // 健檢類型就是「用哪一份範本」，只在建立時決定；
    // 中途換範本會讓已填的作答對不上結構，所以之後不允許更改。
    // 沒有預設類型，一律要求明確指定。
    if (!req.body.templateId) return res.status(422).json({ message: '請先選擇健檢類型' });
    // 嚴格比對：id 不存在就要明確報錯，不能悄悄退到別份範本，
    // 否則使用者選了 A 卻建出 B 類型的報告。
    if (!mongoose.isValidObjectId(req.body.templateId)) {
      return res.status(422).json({ message: '健檢類型格式不正確' });
    }
    const template = await FormTemplate.findById(req.body.templateId);
    if (!template) return res.status(422).json({ message: '找不到指定的健檢類型' });
    if (template.enabled === false) return res.status(422).json({ message: `「${template.name}」已停用，無法用來建立報告` });

    const record = await MedicalRecord.create({
      petId: req.params.petId,
      ...pickRecordFields(req.body),
      templateId: template._id,
      templateVersion: template.version,
      examType: template.name,
    });
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
    // 預覽模式與報告頁共用同一套渲染，草稿也要能拿到區塊結構。
    const sections = record.sections?.length ? record.sections : composeReportSections(record, await templateForRecord(record));
    // 一定要用 toJSON()：toObject() 預設不 flatten Map，展開後 customValues 會變成 {}，
    // 自訂項目的作答一開啟編輯頁就空白，接著自動儲存把 {} 寫回資料庫。
    res.json({ ...record.toJSON(), sections, deliveryStatus: effectiveDeliveryStatus(record) });
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

    const template = await templateForRecord(record);
    // templateForRecord() 找不到會回 null，下面凍結快照時要讀 template._id／version。
    if (!template) {
      return res.status(409).json({ message: '這份報告的健檢類型已不存在，無法結案' });
    }
    const composedSections = composeReportSections(record, template);

    const missing = validateFinalRecord(composedSections);
    if (missing.length) {
      return res.status(422).json({ message: `請先補齊：${missing.join('、')}` });
    }

    const previousFinalizedAt = record.finalizedAt;
    const previousPdfGeneratedAt = record.pdfGeneratedAt;
    const previousTemplateVersion = record.templateVersion;
    record.status = 'finalized';
    record.finalizedAt = new Date();
    record.deliveryStatus = 'not_sent';
    record.deliveryError = '';
    // 結案時凍結表單結構與作答，日後改範本不會影響這份已結案報告。
    record.templateId = template._id;
    record.templateVersion = template.version;
    record.sections = composedSections;
    await record.save();

    try {
      await renderReportPdf(record.shareToken);
    } catch (pdfError) {
      record.status = 'draft';
      record.finalizedAt = previousFinalizedAt;
      record.pdfGeneratedAt = previousPdfGeneratedAt;
      // 只回滾「結案時才產生」的東西。templateId 是建立報告時就綁定的，
      // 清掉它會讓這份草稿失去自己的健檢類型，之後連編輯頁都打不開。
      record.templateVersion = previousTemplateVersion;
      record.sections = [];
      await record.save();
      pdfError.isFinalizePdfError = true;
      throw pdfError;
    }

    record.pdfGeneratedAt = new Date();
    await record.save();
    if (record.revisionOf) {
      try {
        await MedicalRecord.findByIdAndUpdate(record.revisionOf, { supersededBy: record._id });
      } catch (supersedeError) {
        console.error('報告已結案，但標記前一版為已被取代失敗', supersedeError);
      }
    }
    // 靠 role 找體重，不寫死欄位名稱；使用者若停用或刪除該欄位就不同步。
    const weightItem = composedSections.flatMap((section) => section.items ?? []).find((item) => item.role === 'weight');
    // Number(null) 與 Number('') 都是 0 —— 沒填體重時不能把寵物的體重蓋成 0。
    const weightText = String(weightItem?.value ?? '').trim();
    const weightValue = Number(weightText);
    if (weightText && Number.isFinite(weightValue)) {
      try {
        await Pet.findByIdAndUpdate(record.petId, { weightKg: weightValue });
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
      // 這條路徑不會走到全域錯誤處理，不自己記一筆就完全查不到失敗原因。
      console.error('結案時產生 PDF 失敗', err);
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
      // 修訂版沿用原報告的健檢類型，才會看到同一份表單結構。
      templateId: source.templateId,
      templateVersion: source.templateVersion,
      examType: source.examType,
      sections: [],
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
      url: `${publicAppOrigin(req)}/report/${record.shareToken}`,
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
    const reportUrl = `${publicAppOrigin(req)}/report/${record.shareToken}`;
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

    // 已結案報告用自己的快照；草稿還沒凍結結構，即時用目前範本組合。
    const sections = record.sections?.length ? record.sections : composeReportSections(record, await templateForRecord(record));
    res.json(reportPayload(record, sections));
  } catch (err) {
    next(err);
  }
});
