import { Router } from 'express';
import mongoose from 'mongoose';
import FormTemplate from '../models/FormTemplate.js';
import MedicalRecord from '../models/MedicalRecord.js';
import DeletedMedicalRecord from '../models/DeletedMedicalRecord.js';
import DeliveryLog from '../models/DeliveryLog.js';
import Pet from '../models/Pet.js';
import Owner from '../models/Owner.js';
import { renderReportPdf } from '../lib/pdf.js';
import { assertMailConfigured, sendHealthReportEmail } from '../lib/mailer.js';
import { pdfAccessSecret } from '../config/pdfAccess.js';
import { publicAppOrigin } from '../config/publicUrl.js';
import { templateForRecord } from '../lib/formTemplate.js';
import { composeReportSections } from '../lib/reportSections.js';
import { escapeRegExp } from '../lib/regex.js';
import { validateFinalRecord } from '../lib/recordValidation.js';
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

// 跨寵物的健檢紀錄清單。存在的理由是「分發」這一端需要一個集散地：
// 儀錶板只給得出數字與最近幾筆，其餘報告過去只能一隻一隻寵物翻進去找，
// 寄送失敗的報告尤其容易就這樣消失在系統裡。
//
// view 是預設的工作佇列，status／delivery 則是細部篩選，兩者可以疊加。
const RECORD_VIEW_FILTERS = {
  // 待辦＝還沒送到飼主手上的：草稿，以及已結案但未寄送／寄送中／寄送失敗的。
  todo: { $or: [{ status: 'draft' }, { deliveryStatus: { $ne: 'sent' } }] },
  drafts: { status: 'draft' },
  pending: { status: 'finalized', deliveryStatus: { $in: ['not_sent', 'sending'] } },
  failed: { deliveryStatus: 'failed' },
  sent: { deliveryStatus: 'sent' },
  all: {},
};

const RECORD_LIST_FIELDS =
  'petId reportNumber vet visitDate examType status deliveryStatus deliveryError reportVersion sentAt finalizedAt updatedAt createdAt';
const RECORD_LIST_POPULATE = {
  path: 'petId',
  select: 'name species medicalRecordNumber ownerId',
  populate: { path: 'ownerId', select: 'name phone email' },
};

// 關鍵字可能指向寵物或飼主，那是另外兩個 collection——先解析成 petId 清單，
// 再併進報告自己的欄位（報告編號、獸醫師）一起比對。
async function petIdsMatching(pattern) {
  const owners = await Owner.find({ $or: [{ name: pattern }, { phone: pattern }, { email: pattern }] }).select('_id');
  const ownerIds = owners.map((owner) => owner._id);
  const pets = await Pet.find({
    $or: [
      { name: pattern },
      { medicalRecordNumber: pattern },
      ...(ownerIds.length ? [{ ownerId: { $in: ownerIds } }] : []),
    ],
  }).select('_id');
  return pets.map((pet) => pet._id);
}

async function buildRecordListFilter(query) {
  const filter = {};
  const and = [];

  const view = RECORD_VIEW_FILTERS[query.view] ? query.view : 'todo';
  if (Object.keys(RECORD_VIEW_FILTERS[view]).length) and.push(RECORD_VIEW_FILTERS[view]);

  if (['draft', 'finalized'].includes(query.status)) filter.status = query.status;
  if (['not_sent', 'sending', 'sent', 'failed'].includes(query.delivery)) filter.deliveryStatus = query.delivery;
  if (String(query.vet ?? '').trim()) filter.vet = new RegExp(escapeRegExp(String(query.vet).trim()), 'i');

  // 被修訂版取代的舊版預設不列出：同一次健檢在清單上只該出現最後定稿的那份，
  // 否則改過三次的報告會佔掉三行。要看修訂歷程請開個別報告。
  if (query.includeSuperseded !== '1') filter.supersededBy = null;

  const visitDate = {};
  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to) : null;
  if (from && !Number.isNaN(from.getTime())) visitDate.$gte = from;
  if (to && !Number.isNaN(to.getTime())) {
    // to 是使用者選的「那一天」，要包含整天，所以比到當天結束。
    to.setHours(23, 59, 59, 999);
    visitDate.$lte = to;
  }
  if (Object.keys(visitDate).length) filter.visitDate = visitDate;

  const keyword = String(query.q ?? '').trim();
  if (keyword) {
    const pattern = new RegExp(escapeRegExp(keyword), 'i');
    const petIds = await petIdsMatching(pattern);
    and.push({
      $or: [
        { reportNumber: pattern },
        { vet: pattern },
        ...(petIds.length ? [{ petId: { $in: petIds } }] : []),
      ],
    });
  }

  if (and.length) filter.$and = and;
  return { filter, view };
}

recordsRouter.get('/', async (req, res, next) => {
  try {
    const { filter, view } = await buildRecordListFilter(req.query);
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 25, 1), 100);

    // 佇列上的數字不套用關鍵字與日期篩選——它們回答的是「還有多少事沒做完」，
    // 會隨著使用者打字忽上忽下的話就失去參考價值了。
    const [items, total, counts] = await Promise.all([
      MedicalRecord.find(filter)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select(RECORD_LIST_FIELDS)
        .populate(RECORD_LIST_POPULATE),
      MedicalRecord.countDocuments(filter),
      Promise.all(
        Object.entries(RECORD_VIEW_FILTERS).map(async ([key, viewFilter]) => [
          key,
          await MedicalRecord.countDocuments({ supersededBy: null, ...viewFilter }),
        ])
      ).then(Object.fromEntries),
    ]);

    res.json({ items, total, page, limit, view, counts });
  } catch (err) {
    next(err);
  }
});

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
    // 草稿與已結案但還沒寄送的報告都可以刪；已經寄出的不給刪（飼主手上已經有連結／附件，
    // 刪除本地紀錄也追不回去），寄送中的也不給刪（避免刪除跟寄送流程互相打架）。
    if (record.deliveryStatus === 'sent' || record.deliveryStatus === 'sending') {
      const message = record.deliveryStatus === 'sending' ? '報告寄送中，請稍後再刪除' : '已寄送的報告不能刪除';
      return res.status(409).json({ message });
    }
    // 只有已結案的報告要打字確認。它已經產生過正式 PDF、可能也已經給過飼主連結，
    // 是真的刪掉就回不去的東西；草稿則是隨手開、隨手丟的工作中狀態，
    // 「捨棄剛剛開錯的草稿」要求先抄一次寵物名，只會讓人開始無視這個確認。
    //
    // 確認方式仿 GitHub 刪除 repository：要求把一段文字原封不動打進來，
    // 防的是「手滑點到刪除又手滑點到確認」這種連續誤觸。
    // 比對的是寵物名而不是報告編號——編號是一串記不住的亂碼，只能照抄，
    // 抄的過程不會讓人意識到自己在刪什麼；打出寵物名則會。
    if (isFinalizedRecord(record)) {
      // 另外查一次而不是 populate：record 後面要整份存進稽核快照，不希望它被塞進 pet 文件。
      const pet = await Pet.findById(record.petId).select('name');
      const expected = String(pet?.name ?? '').trim();
      const confirmText = String(req.body?.confirmText ?? '').trim();
      if (!expected || confirmText !== expected) {
        return res.status(422).json({ message: '確認文字不符，請輸入完整的寵物名稱' });
      }
    }
    // 刪除前先存一份快照，供之後回溯查詢或還原用。
    await DeletedMedicalRecord.create({
      originalId: record._id,
      petId: record.petId,
      reportNumber: record.reportNumber,
      status: record.status,
      deliveryStatus: record.deliveryStatus,
      snapshot: record.toObject(),
    });
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

// 每次寄送嘗試都往流水帳補一筆。寵物與飼主姓名在這裡就抄進去，不留 ref——
// 這筆紀錄的價值正是在報告被刪除之後還查得到，那時 populate 只會拿到 null。
async function logDelivery(record, event, extra = {}) {
  if (!record?._id) return;
  try {
    const pet = record.petId;
    const owner = pet?.ownerId;
    await DeliveryLog.create({
      recordId: record._id,
      reportNumber: record.reportNumber || '',
      petName: pet?.name || '',
      ownerName: owner?.name || '',
      event,
      ...extra,
    });
  } catch (err) {
    // 流水帳寫不進去不該讓寄送本身失敗——信有沒有送到飼主手上才是主線。
    console.error('寫入寄送紀錄失敗', err);
  }
}

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
    // 先記 queued：後面產 PDF 或 SMTP 卡住而程序被中斷時，至少留得下「曾經嘗試寄送」。
    await logDelivery(record, 'queued', { recipient });

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
    await logDelivery(record, 'sent', { recipient, messageId: info.messageId });

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
      // record.deliveryError 只留得住最後一次失敗，流水帳這筆才是完整的失敗歷程。
      await logDelivery(record, 'failed', {
        recipient: record.petId?.ownerId?.email?.trim() || '',
        error: record.deliveryError,
      });
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
