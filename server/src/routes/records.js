import { Router } from 'express';
import mongoose from 'mongoose';
import FormTemplate from '../models/FormTemplate.js';
import MedicalRecord from '../models/MedicalRecord.js';
import DeliveryLog from '../models/DeliveryLog.js';
import Pet from '../models/Pet.js';
import Owner from '../models/Owner.js';
import { enqueueReportPdf, readStoredPdf, streamStoredPdf } from '../lib/reportPdfJobs.js';
import { assertMailConfigured, isAmbiguousMailFailure, sendHealthReportEmail } from '../lib/mailer.js';
import { hasPdfRenderAccess } from '../config/pdfAccess.js';
import { publicAppOrigin } from '../config/publicUrl.js';
import { defaultRecordFields, storageFor, templateForRecord } from '../lib/formTemplate.js';
import { deleteCloudinaryImages, removedImagePublicIds, imagePublicIds, sanitizeImageValue } from '../lib/imageUploads.js';
import { composeReportSections } from '../lib/reportSections.js';
import { escapeRegExp } from '../lib/regex.js';
import { validateFinalRecord } from '../lib/recordValidation.js';
import { withTransaction } from '../lib/transaction.js';
import { paginatedPayload, paginationOptions } from '../lib/pagination.js';
import { enrichSectionsWithPreviousValues, getPetPreviousValues, plainSections } from '../lib/historyValues.js';
import { clinicDayStart } from '../lib/clinicTime.js';
import { v4 as uuidv4 } from 'uuid';

// examType 不在這裡 —— 它等同於「用哪一份範本」，只在建立報告時決定，
// 之後不能透過一般更新改動，否則已填的作答會對不上表單結構。
const RECORD_FIELDS = [
  'vet',
  'visitDate',
  'followUpDate',
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

function sameImages(left, right) {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

function sanitizeRecordImages(data, template, existingRecord = null) {
  if (!data.customValues || typeof data.customValues !== 'object') return data;
  const imageKeys = new Set(
    (template?.sections ?? []).flatMap((section) => (section.items ?? [])
      .filter((item) => item.type === 'image' && storageFor(item) === 'custom')
      .map((item) => item.key))
  );
  const customValues = { ...data.customValues };
  for (const key of imageKeys) {
    if (customValues[key] !== undefined && !sameImages(customValues[key], existingRecord?.customValues?.[key])) {
      customValues[key] = sanitizeImageValue(customValues[key]);
    }
  }
  return { ...data, customValues };
}

async function cleanUpImages(publicIds, context) {
  if (!publicIds.length) return;
  try {
    await deleteCloudinaryImages(publicIds);
  } catch (err) {
    // 資料庫操作已完成；清理失敗只能記錄，不能讓使用者誤以為儲存或刪除失敗。
    console.error(`[image-cleanup] ${context}`, err);
  }
}

function isFinalizedRecord(record) {
  return Boolean(record && record.status !== 'draft');
}

function effectiveDeliveryStatus(record) {
  return record?.deliveryStatus ?? 'not_sent';
}

// 報告檢視要看的那份區塊結構。
//
// 已結案的一律直接用自己的快照，不再回頭補「上次數值」——快照的意義就是「結案當下的樣子」。
// 補登一份日期更早的報告會讓歷史往回長，那時再回頭加工，已經寄給飼主的報告重新開啟
// 就會多出當初 PDF 上沒有的對照欄，而 PDF 是每次重繪的，附件與線上版會對不起來。
// 順帶省下兩支查詢：補對照值要撈最多 20 份帶完整 sections 的報告，而公開報告頁
// 正是 Puppeteer 產 PDF 的來源，結案與寄信路徑上各會走一次。
//
// 草稿還沒凍結結構，仍要即時用目前範本組合並補上對照值。
async function sectionsForView(record) {
  if (isFinalizedRecord(record) && record.sections?.length) return plainSections(record.sections);
  const rawSections = record.sections?.length
    ? record.sections
    : composeReportSections(record, await templateForRecord(record));
  const previousValues = await getPetPreviousValues(record.petId, record._id, record);
  return enrichSectionsWithPreviousValues(rawSections, previousValues);
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
    followUpDate: record.followUpDate,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    status: record.status,
    finalizedAt: record.finalizedAt,
    pdfGeneratedAt: record.pdfGeneratedAt,
    pdfStatus: record.pdfStatus || 'pending',
    pdfError: record.pdfError || '',
    reportVersion: record.reportVersion || 1,
    revisionReason: record.revisionReason,
    hasNewerVersion: Boolean(record.supersededBy),
    // 這份 payload 只給公開分享連結使用，寄送作業的內部欄位
    //（deliveryError／lastDeliveryAttemptAt／sentTo）不對飼主外露。
    deliveryStatus: effectiveDeliveryStatus(record),
    sentAt: record.sentAt,
    shareEnabled: record.shareEnabled,
    shareExpiresAt: record.shareExpiresAt,
    pet: pet
      ? {
          name: pet.name,
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
const PET_RECORD_LIST_FIELDS =
  'petId reportNumber vet visitDate examType status deliveryStatus deliveryError reportVersion revisionOf revisionRootId supersededBy shareToken shareEnabled sharedAt shareExpiresAt sentAt sentTo finalizedAt updatedAt createdAt';

petRecordsRouter.get('/', async (req, res, next) => {
  try {
    const pagination = paginationOptions(req.query);
    // 寵物頁只畫摘要，不能把每份報告的大型 sections 快照與全部臨床內容一起載回。
    const filter = { petId: req.params.petId };
    const [records, total] = await Promise.all([
      MedicalRecord.find(filter)
        .sort({ visitDate: -1, reportVersion: -1, updatedAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .select(PET_RECORD_LIST_FIELDS)
        .lean(),
      MedicalRecord.countDocuments(filter),
    ]);
    res.json(paginatedPayload(records, total, pagination));
  } catch (err) {
    next(err);
  }
});

// ── 填表時的「上次數值」──
// 這隻寵物過去每個項目最近一次的紀錄，不限健檢類型：只要以前量過血小板，
// 這次的表單有血小板就能顯示上次的值，即使兩次用的是不同的健檢表單。
// 只收得出數值的型別 —— 理學檢查只有正常／異常，沒有可以拿來對照的數字。
// 逐份走訪已結案報告找「每個項目最近一次」的值。太久以前的紀錄拿來對照的意義有限，
// 也不該讓填表頁為了翻完全部病歷而多等，只看最近這幾份。
const FINALIZE_LEASE_MS = 5 * 60 * 1000;
const DELIVERY_LEASE_MS = 10 * 60 * 1000;
const configuredShareDays = Number.parseInt(process.env.SHARE_LINK_DAYS, 10);
const DEFAULT_SHARE_DAYS = Number.isInteger(configuredShareDays) && configuredShareDays > 0
  ? Math.min(configuredShareDays, 365)
  : 30;

function shareExpiryFromNow(days = DEFAULT_SHARE_DAYS) {
  const safeDays = Number.isInteger(days) ? Math.min(Math.max(days, 1), 365) : DEFAULT_SHARE_DAYS;
  return new Date(Date.now() + safeDays * 24 * 60 * 60 * 1000);
}

// 正在填的這份報告與它的其他版本都不算「上次」——
// 修訂草稿要對照的是更早的那次健檢，不是自己的前一版。
//
// 也要帶上這份報告自己的日期當歷史邊界。少了它，編輯一份較早的報告時
// 「上次數值」會抓到比它更晚的看診，跟預覽頁與結案快照（那三處都有傳 record）
// 對同一個欄位顯示不同的值。新報告沒有 excludeRecordId，本來就沒有邊界可言。
petRecordsRouter.get('/previous-values', async (req, res, next) => {
  try {
    const excludeRecordId = req.query.excludeRecordId;
    const boundary = mongoose.isValidObjectId(excludeRecordId)
      ? await MedicalRecord.findById(excludeRecordId).select('visitDate finalizedAt')
      : null;
    const data = await getPetPreviousValues(req.params.petId, excludeRecordId, boundary);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// 建立新健檢時可選擇任一份已結案報告帶入文字內容。
// 只回傳來源資訊；實際內容仍由既有報告端點取得，避免這支清單端點意外擴大資料範圍。
petRecordsRouter.get('/finalized-sources', async (req, res, next) => {
  try {
    const records = await MedicalRecord.find({
      petId: req.params.petId,
      status: { $ne: 'draft' },
    })
      .sort({ finalizedAt: -1, visitDate: -1, reportVersion: -1, updatedAt: -1 })
      .limit(20)
      .select('templateId examType visitDate finalizedAt reportVersion');
    res.json(records);
  } catch (err) {
    next(err);
  }
});

petRecordsRouter.post('/', async (req, res, next) => {
  try {
    // 健檢類型就是「用哪一份範本」，只在建立時決定；
    // 中途換範本會讓已填的作答對不上結構，所以之後不允許更改。
    // 沒有預設類型，一律要求明確指定。
    if (!req.body.templateId) return res.status(422).json({ message: '請先選擇健檢類型' });
    // 嚴格比對：id 不存在就要明確報錯，不能悄悄退到別份範本，
    // 否則使用者選了 A 卻建出 B 類型的報告。
    if (!mongoose.isValidObjectId(req.body.templateId)) {
      return res.status(422).json({ message: '健檢類型格式不正確' });
    }
    let record;
    await withTransaction(async (session) => {
      // 遞增父文件 relationVersion，讓「建立報告」與「刪除寵物／表單」無法同時提交。
      const pet = await Pet.findOneAndUpdate(
        { _id: req.params.petId },
        { $inc: { relationVersion: 1 } },
        { new: true, session }
      ).select('+relationVersion');
      if (!pet) {
        const error = new Error('找不到寵物');
        error.status = 404;
        throw error;
      }

      const template = await FormTemplate.findOneAndUpdate(
        { _id: req.body.templateId, enabled: { $ne: false } },
        { $inc: { relationVersion: 1 } },
        { new: true, session }
      ).select('+relationVersion');
      if (!template) {
        const error = new Error('找不到指定的健檢類型，或該類型已停用');
        error.status = 422;
        throw error;
      }

      const recordFields = sanitizeRecordImages(pickRecordFields(req.body), template);
      const defaults = defaultRecordFields(template);
      [record] = await MedicalRecord.create([{
        petId: pet._id,
        ...defaults,
        ...recordFields,
        customValues: { ...(defaults.customValues ?? {}), ...(recordFields.customValues ?? {}) },
        templateId: template._id,
        templateVersion: template.version,
        examType: template.name,
      }], { session });
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
  pending: { status: 'finalized', deliveryStatus: { $in: ['not_sent', 'sending', 'uncertain'] } },
  failed: { deliveryStatus: { $in: ['failed', 'uncertain'] } },
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

export function recordVisitDateRange(query = {}) {
  const visitDate = {};
  const from = clinicDayStart(query.from);
  const to = clinicDayStart(query.to, 1);
  if (from) visitDate.$gte = from;
  if (to) visitDate.$lt = to;
  return visitDate;
}

async function buildRecordListFilter(query) {
  const filter = {};
  const and = [];

  const view = RECORD_VIEW_FILTERS[query.view] ? query.view : 'todo';
  if (Object.keys(RECORD_VIEW_FILTERS[view]).length) and.push(RECORD_VIEW_FILTERS[view]);

  if (['draft', 'finalized'].includes(query.status)) filter.status = query.status;
  if (['not_sent', 'sending', 'sent', 'failed', 'uncertain'].includes(query.delivery)) filter.deliveryStatus = query.delivery;
  if (String(query.vet ?? '').trim()) filter.vet = new RegExp(escapeRegExp(String(query.vet).trim()), 'i');

  // 被修訂版取代的舊版預設不列出：同一次健檢在清單上只該出現最後定稿的那份，
  // 否則改過三次的報告會佔掉三行。要看修訂歷程請開個別報告。
  if (query.includeSuperseded !== '1') filter.supersededBy = null;

  const visitDate = recordVisitDateRange(query);
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
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 10, 1), 100);

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
    // 預覽模式與報告頁共用同一套渲染，草稿也要能拿到區塊結構與歷史對照數值。
    const sections = await sectionsForView(record);
    // 一定要用 toJSON()：toObject() 預設不 flatten Map，展開後 customValues 會變成 {}，
    // 自訂項目的作答一開啟編輯頁就空白，接著自動儲存把 {} 寫回資料庫。
    res.json({ ...record.toJSON(), sections, deliveryStatus: effectiveDeliveryStatus(record) });
  } catch (err) {
    next(err);
  }
});

recordsRouter.put('/:id', async (req, res, next) => {
  try {
    const expectedVersion = Number(req.body?.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return res.status(428).json({ message: '缺少病歷版本資訊，請重新整理後再儲存' });
    }
    const existingForValidation = await MedicalRecord.findById(req.params.id).select('templateId customValues');
    if (!existingForValidation) return res.status(404).json({ message: '找不到指定的健康報告' });
    const template = await templateForRecord(existingForValidation);
    const recordFields = sanitizeRecordImages(pickRecordFields(req.body), template, existingForValidation);
    const record = await MedicalRecord.findOneAndUpdate(
      {
        _id: req.params.id,
        status: 'draft',
        __v: expectedVersion,
        $or: [{ finalizeAttemptId: null }, { finalizeAttemptId: { $exists: false } }],
      },
      { $set: recordFields, $inc: { __v: 1 } },
      { new: true, runValidators: true }
    );
    if (!record) {
      const existing = await MedicalRecord.findById(req.params.id).select('+finalizeAttemptId');
      if (!existing) return res.status(404).json({ message: '找不到報告' });
      if (existing?.status === 'draft' && existing.finalizeAttemptId) {
        return res.status(409).json({ message: '病歷正在結案並產生 PDF，請稍後再試' });
      }
      if (existing.status !== 'draft') {
        return res.status(409).json({ message: '這份報告已結案，無法直接修改，請建立修訂草稿' });
      }
      return res.status(409).json({
        message: '這份草稿已在其他分頁或裝置更新。為避免覆蓋內容，請重新整理後再編輯。',
        currentVersion: existing.__v,
      });
    }
    await cleanUpImages(removedImagePublicIds(existingForValidation, record), `record ${record._id} updated`);
    res.json(record);
  } catch (err) {
    next(err);
  }
});

recordsRouter.post('/:id/finalize', async (req, res, next) => {
  let record;
  let finalizeAttemptId = '';
  let previousTemplateVersion = null;
  let didFinalize = false;
  try {
    record = await MedicalRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ message: '找不到報告' });
    if (isFinalizedRecord(record)) {
      return res.json({
        status: 'finalized',
        finalizedAt: record.finalizedAt,
        pdfGeneratedAt: record.pdfGeneratedAt,
        pdfStatus: record.pdfStatus || 'pending',
        pdfError: record.pdfError || '',
        reportVersion: record.reportVersion || 1,
        deliveryStatus: effectiveDeliveryStatus(record),
        documentVersion: record.__v,
      });
    }

    const expectedVersion = Number(req.body?.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return res.status(428).json({ message: '缺少預覽版本資訊，請重新整理報告後再結案' });
    }
    if (record.__v !== expectedVersion) {
      return res.status(409).json({
        message: '病歷在預覽後已被更新。系統已重新載入最新內容，請確認後再結案。',
        currentVersion: record.__v,
      });
    }

    const template = await templateForRecord(record);
    // templateForRecord() 找不到會回 null，下面凍結快照時要讀 template._id／version。
    if (!template) {
      return res.status(409).json({ message: '這份報告的健檢類型已不存在，無法結案' });
    }
    const previousValues = await getPetPreviousValues(record.petId, record._id, record);
    const composedSections = enrichSectionsWithPreviousValues(composeReportSections(record, template), previousValues);

    const missing = validateFinalRecord(composedSections);
    if (missing.length) {
      return res.status(422).json({ message: `請先補齊：${missing.join('、')}` });
    }

    previousTemplateVersion = record.templateVersion;
    finalizeAttemptId = uuidv4();
    const lockedRecord = await MedicalRecord.findOneAndUpdate(
      {
        _id: record._id,
        status: 'draft',
        __v: expectedVersion,
        updatedAt: record.updatedAt,
        $or: [
          { finalizeAttemptId: null },
          { finalizeAttemptId: { $exists: false } },
          { finalizingAt: { $lte: new Date(Date.now() - FINALIZE_LEASE_MS) } },
        ],
      },
      {
        $set: {
          finalizeAttemptId,
          finalizingAt: new Date(),
          templateId: template._id,
          templateVersion: template.version,
          sections: composedSections,
          deliveryStatus: 'not_sent',
          deliveryError: '',
        },
      },
      { new: true }
    ).select('+finalizeAttemptId +finalizingAt');
    if (!lockedRecord) {
      return res.status(409).json({ message: '病歷正在結案或已被更新，請重新整理後再試' });
    }
    record = lockedRecord;

    // 靠 role 找體重，不寫死欄位名稱；使用者若停用或刪除該欄位就不同步。
    const weightItem = composedSections.flatMap((section) => section.items ?? []).find((item) => item.role === 'weight');
    // Number(null) 與 Number('') 都是 0 —— 沒填體重時不能把寵物的體重蓋成 0。
    const weightText = String(weightItem?.value ?? '').trim();
    const weightValue = Number(weightText);
    const finalizedAt = new Date();
    await withTransaction(async (session) => {
      const finalizedRecord = await MedicalRecord.findOneAndUpdate(
        { _id: record._id, status: 'draft', finalizeAttemptId },
        {
          $set: {
            status: 'finalized',
            finalizedAt,
            pdfGeneratedAt: null,
            pdfStatus: 'pending',
            pdfError: '',
            pdfAttemptedAt: null,
            pdfFileId: null,
            deliveryStatus: 'not_sent',
            deliveryError: '',
          },
          $inc: { __v: 1 },
          $unset: { finalizeAttemptId: 1, finalizingAt: 1 },
        },
        { new: true, session }
      );
      if (!finalizedRecord) {
        const error = new Error('結案工作已失去擁有權，請重新整理後確認報告狀態');
        error.status = 409;
        throw error;
      }

      if (record.revisionOf) {
        const superseded = await MedicalRecord.updateOne(
          { _id: record.revisionOf, status: 'finalized', supersededBy: null },
          { $set: { supersededBy: record._id } },
          { session }
        );
        if (superseded.matchedCount !== 1) {
          const error = new Error('前一版報告已被其他修訂取代，無法建立分叉版本');
          error.status = 409;
          throw error;
        }
      }

      if (weightText && Number.isFinite(weightValue)) {
        const petUpdate = await Pet.updateOne(
          { _id: record.petId },
          { $set: { weightKg: weightValue } },
          { session }
        );
        if (petUpdate.matchedCount !== 1) {
          const error = new Error('找不到報告所屬寵物，無法完成結案');
          error.status = 409;
          throw error;
        }
      }
      record = finalizedRecord;
    });
    didFinalize = true;
    enqueueReportPdf();

    res.json({
      status: 'finalized',
      finalizedAt: record.finalizedAt,
      pdfGeneratedAt: null,
      pdfStatus: 'pending',
      reportVersion: record.reportVersion || 1,
      deliveryStatus: effectiveDeliveryStatus(record),
      documentVersion: record.__v,
    });
  } catch (err) {
    if (record?._id && finalizeAttemptId && !didFinalize && !err.isFinalizePdfError) {
      try {
        await MedicalRecord.updateOne(
          { _id: record._id, finalizeAttemptId },
          {
            $set: { status: 'draft', templateVersion: previousTemplateVersion, sections: [] },
            $unset: { finalizeAttemptId: 1, finalizingAt: 1 },
          }
        );
      } catch (cleanupError) {
        console.error('結案失敗後釋放鎖定時發生錯誤', cleanupError);
      }
    }
    if (err.isFinalizePdfError) {
      // 這條路徑不會走到全域錯誤處理，不自己記一筆就完全查不到失敗原因。
      console.error('結案時產生 PDF 失敗', err);
      return res.status(502).json({ message: 'PDF 產生失敗，報告仍維持草稿，請稍後再試' });
    }
    next(err);
  }
});

recordsRouter.post('/:id/pdf/retry', async (req, res, next) => {
  try {
    const record = await MedicalRecord.findOneAndUpdate(
      { _id: req.params.id, status: 'finalized', pdfStatus: { $in: ['failed', 'pending'] } },
      { $set: { pdfStatus: 'pending', pdfError: '', pdfAttemptedAt: null } },
      { new: true }
    );
    if (!record) return res.status(409).json({ message: '這份報告目前無法重新產生 PDF。' });
    enqueueReportPdf();
    res.status(202).json({ pdfStatus: 'pending' });
  } catch (err) {
    next(err);
  }
});

recordsRouter.get('/:id/pdf', async (req, res, next) => {
  try {
    const record = await MedicalRecord.findById(req.params.id).select('+pdfFileId');
    if (!record) return res.status(404).json({ message: '找不到報告' });
    if (!isFinalizedRecord(record)) {
      return res.status(409).json({ message: '請先結案，再下載正式 PDF' });
    }
    if (record.pdfStatus !== 'ready') {
      return res.status(409).json({ message: record.pdfStatus === 'failed' ? 'PDF 產生失敗，請重試。' : 'PDF 正在產生中，完成後即可下載。' });
    }
    // The finished PDF is immutable and streamed directly from GridFS.
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safePdfFilename(record)}"`);
    if (!(await streamStoredPdf(record, res))) {
      return res.status(409).json({ message: 'PDF 正在準備中，請稍後再試。' });
    }
  } catch (err) {
    next(err);
  }
});

recordsRouter.post('/:id/revisions', async (req, res, next) => {
  try {
    let revision;
    await withTransaction(async (session) => {
      const source = await MedicalRecord.findById(req.params.id).session(session);
      if (!source) {
        const error = new Error('找不到報告');
        error.status = 404;
        throw error;
      }
      if (!isFinalizedRecord(source)) {
        const error = new Error('草稿可直接編輯，不需要建立修訂版');
        error.status = 409;
        throw error;
      }
      if (source.supersededBy) {
        const error = new Error('這份報告已有後續修訂版本');
        error.status = 409;
        error.details = { newerRecordId: source.supersededBy };
        throw error;
      }

      const existingDraft = await MedicalRecord.findOne({ revisionOf: source._id, status: 'draft' }).session(session);
      if (existingDraft) {
        const error = new Error('這份報告已有待完成的修訂草稿');
        error.status = 409;
        error.details = { revisionId: existingDraft._id };
        throw error;
      }

      const rootId = source.revisionRootId || source._id;
      const latestVersion = await MedicalRecord.findOne({
        $or: [{ _id: rootId }, { revisionRootId: rootId }],
      }).sort({ reportVersion: -1 }).select('reportVersion').session(session);
      const reportVersion = Math.max(latestVersion?.reportVersion || 1, source.reportVersion || 1) + 1;

      const touchedSource = await MedicalRecord.updateOne(
        { _id: source._id, status: 'finalized', supersededBy: null },
        { $inc: { relationVersion: 1 } },
        { session }
      );
      if (touchedSource.matchedCount !== 1) {
        const error = new Error('報告正在被其他修訂或刪除操作更新，請重新整理後再試');
        error.status = 409;
        throw error;
      }

      [revision] = await MedicalRecord.create([{
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
        shareExpiresAt: null,
        sentAt: undefined,
        sentTo: undefined,
        emailMessageId: undefined,
      }], { session });
    });

    res.status(201).json(revision);
  } catch (err) {
    if (err.code === 11000) {
      const revision = await MedicalRecord.findOne({ revisionOf: req.params.id, status: 'draft' });
      if (revision) {
        return res.status(409).json({
          message: '這份報告已有修訂草稿',
          revisionId: revision._id,
        });
      }
    }
    next(err);
  }
});

recordsRouter.delete('/:id', async (req, res, next) => {
  let deletedImageIds = [];
  try {
    const record = await MedicalRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ message: '找不到報告' });
    // 草稿與已結案但還沒寄送的報告都可以刪；已經寄出的不給刪（飼主手上已經有連結／附件，
    // 刪除本地紀錄也追不回去），寄送中的也不給刪（避免刪除跟寄送流程互相打架）。
    if (['sent', 'sending', 'uncertain'].includes(record.deliveryStatus)) {
      const message = record.deliveryStatus === 'sending'
        ? '報告寄送中，請稍後再刪除'
        : record.deliveryStatus === 'uncertain'
          ? '寄送結果尚待確認，為避免刪除可能已寄出的報告，目前不能刪除'
          : '已寄送的報告不能刪除';
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
    // 修訂鏈回復與刪除必須一起成功；任何一步失敗就全部回滾。
    await withTransaction(async (session) => {
      const current = await MedicalRecord.findById(record._id).session(session);
      if (!current) {
        const error = new Error('找不到報告，可能已由其他操作刪除');
        error.status = 404;
        throw error;
      }
      if (['sent', 'sending', 'uncertain'].includes(current.deliveryStatus)) {
        const error = new Error('報告已寄送、正在寄送或寄送結果待確認，不能刪除');
        error.status = 409;
        throw error;
      }
      if (current.supersededBy) {
        const error = new Error('這份報告屬於修訂歷程中的舊版本，不能單獨刪除');
        error.status = 409;
        throw error;
      }
      deletedImageIds = imagePublicIds(current);
      // 報告可能在最初讀取與 transaction 開始之間剛好完成結案，
      // 因此確認文字必須用 transaction 內的最新狀態再驗一次。
      if (isFinalizedRecord(current)) {
        const currentPet = await Pet.findById(current.petId).select('name').session(session);
        if (!currentPet) {
          const error = new Error('找不到報告所屬寵物，無法確認刪除');
          error.status = 409;
          throw error;
        }
        const confirmedName = String(req.body?.confirmText ?? '').trim();
        if (confirmedName !== String(currentPet.name ?? '').trim()) {
          const error = new Error('確認文字不符，請輸入完整的寵物名稱');
          error.status = 422;
          throw error;
        }
      }

      if (current.revisionOf && isFinalizedRecord(current)) {
        const restoredPrevious = await MedicalRecord.updateOne(
          { _id: current.revisionOf, supersededBy: current._id },
          { $set: { supersededBy: null } },
          { session }
        );
        if (restoredPrevious.matchedCount !== 1) {
          const error = new Error('修訂歷程已被其他操作更新，請重新整理後再試');
          error.status = 409;
          throw error;
        }
      }

      const deleted = await MedicalRecord.deleteOne({ _id: current._id }, { session });
      if (deleted.deletedCount !== 1) {
        const error = new Error('刪除報告時發生競態，請重新整理後再試');
        error.status = 409;
        throw error;
      }
    });
    await cleanUpImages(deletedImageIds, `record ${req.params.id} deleted`);
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
    record.shareExpiresAt = shareExpiryFromNow(Number.parseInt(req.body?.expiresInDays, 10));
    await record.save();

    res.json({
      url: `${publicAppOrigin(req)}/report/${record.shareToken}`,
      expiresAt: record.shareExpiresAt,
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

function mailErrorResponse(err) {
  if (err.code === 'MAIL_NOT_CONFIGURED') return { status: 503, message: err.message };
  if (err.code === 'MAIL_RECIPIENT_REJECTED') return { status: 422, message: err.message };
  if (err.code === 'EAUTH') return { status: 502, message: 'Gmail 驗證失敗，請確認寄信設定後再試；報告已結案，不受影響' };
  if (err.code === 'ETIMEDOUT') return { status: 504, message: '連線 Gmail 逾時，請確認網路後再試；報告已結案，不受影響' };
  if (err.code === 'ECONNECTION') return { status: 502, message: '無法連線 Gmail SMTP，請確認網路或防火牆設定；報告已結案，不受影響' };
  if (['EENVELOPE', 'EMESSAGE', 'EPROTOCOL'].includes(err.code)) {
    return { status: 502, message: 'Gmail 未接受這封郵件，請稍後再試；報告已結案，不受影響' };
  }
  return null;
}

recordsRouter.post('/:id/send-email', async (req, res, next) => {
  let record;
  let recipient = '';
  let deliveryAttemptId = '';
  let smtpInfo = null;
  let smtpStarted = false;
  let activeShareExpiresAt = null;
  try {
    record = await MedicalRecord.findById(req.params.id).select('+pdfFileId').populate({
      path: 'petId',
      populate: { path: 'ownerId', select: 'name email' },
    }).select('+deliveryAttemptId +deliveryLeaseExpiresAt');
    if (!record) return res.status(404).json({ message: '找不到報告' });
    if (!isFinalizedRecord(record)) {
      return res.status(409).json({ message: '請先完成結案，再寄送正式報告' });
    }
    if (effectiveDeliveryStatus(record) === 'sending') {
      const leaseIsActive = record.deliveryLeaseExpiresAt && record.deliveryLeaseExpiresAt > new Date();
      if (leaseIsActive) {
        return res.status(409).json({ message: '報告正在寄送中，請勿重複操作' });
      }

      // 程序在寄送中途消失時，不能假設郵件「一定沒寄出」後自動重送。
      // SMTP 可能已經接受，只是本機還沒寫回 sent；先標為待確認，由使用者決定是否重寄。
      await MedicalRecord.updateOne(
        {
          _id: record._id,
          deliveryStatus: 'sending',
          $or: [
            { deliveryLeaseExpiresAt: null },
            { deliveryLeaseExpiresAt: { $exists: false } },
            { deliveryLeaseExpiresAt: { $lte: new Date() } },
          ],
        },
        {
          $set: {
            deliveryStatus: 'uncertain',
            deliveryError: '上一次寄送程序中斷，郵件可能已送出；請先確認收件匣，再決定是否重新寄送',
          },
          $unset: { deliveryAttemptId: 1, deliveryLeaseExpiresAt: 1 },
        }
      );
      return res.status(409).json({
        message: '上一次寄送結果無法確認。請先確認飼主信箱；若確定未收到，再次按下寄送即可重試。',
        deliveryStatus: 'uncertain',
      });
    }

    const pet = record.petId;
    const owner = pet?.ownerId;
    recipient = owner?.email?.trim();
    if (!recipient) return res.status(422).json({ message: '這位飼主尚未填寫 Email，請先補齊飼主資料' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      return res.status(422).json({ message: '飼主 Email 格式不正確，請先修正飼主資料' });
    }

    if (record.pdfStatus !== 'ready') {
      return res.status(409).json({ message: record.pdfStatus === 'failed' ? 'PDF 產生失敗，請先重試。' : 'PDF 正在產生中，完成後才能寄送。' });
    }

    deliveryAttemptId = uuidv4();
    const claimedAt = new Date();
    const claimedDelivery = await MedicalRecord.findOneAndUpdate(
      {
        _id: record._id,
        status: 'finalized',
        deliveryStatus: { $ne: 'sending' },
      },
      {
        $set: {
          deliveryStatus: 'sending',
          deliveryError: '',
          lastDeliveryAttemptAt: claimedAt,
          deliveryAttemptId,
          deliveryLeaseExpiresAt: new Date(claimedAt.getTime() + DELIVERY_LEASE_MS),
        },
      },
      { new: true }
    ).select('+deliveryAttemptId +deliveryLeaseExpiresAt');
    if (!claimedDelivery) {
      return res.status(409).json({ message: '寄送工作已由另一個請求取得，請稍後再查看狀態' });
    }
    // 先記 queued：後面產 PDF 或 SMTP 卡住而程序被中斷時，至少留得下「曾經嘗試寄送」。
    await logDelivery(record, 'queued', { recipient, attemptId: deliveryAttemptId });

    assertMailConfigured();
    const pdfBuffer = await readStoredPdf(record);
    if (!pdfBuffer) {
      const pdfError = new Error('PDF 檔案暫時無法讀取，請重新產生。');
      pdfError.status = 409;
      throw pdfError;
    }
    const reportUrl = `${publicAppOrigin(req)}/report/${record.shareToken}`;

    // 郵件寄出前先確保信內的分享連結已經可用，並把 lease 往後延長涵蓋 SMTP 階段。
    activeShareExpiresAt = record.shareExpiresAt && record.shareExpiresAt > new Date()
      ? record.shareExpiresAt
      : shareExpiryFromNow();
    const readyForSmtp = await MedicalRecord.updateOne(
      { _id: record._id, deliveryAttemptId },
      {
        $set: {
          shareEnabled: true,
          sharedAt: record.sharedAt || new Date(),
          shareExpiresAt: activeShareExpiresAt,
          deliveryLeaseExpiresAt: new Date(Date.now() + DELIVERY_LEASE_MS),
        },
      }
    );
    if (readyForSmtp.matchedCount !== 1) {
      const error = new Error('寄送工作已失去擁有權，已停止寄信');
      error.code = 'DELIVERY_ATTEMPT_LOST';
      throw error;
    }

    smtpStarted = true;
    smtpInfo = await sendHealthReportEmail({
      to: recipient,
      ownerName: owner.name,
      petName: pet.name,
      reportNumber: record.reportNumber,
      reportUrl,
      reportExpiresAt: activeShareExpiresAt,
      pdfBuffer,
    });

    // 只允許取得這次 attempt 的請求寫入結果，避免舊請求覆蓋較新的寄送狀態。
    const sentAt = new Date();
    const sentRecord = await MedicalRecord.findOneAndUpdate(
      { _id: record._id, deliveryAttemptId },
      {
        $set: {
          status: 'finalized',
          deliveryStatus: 'sent',
          deliveryError: '',
          pdfGeneratedAt: sentAt,
          sentAt,
          sentTo: recipient,
          emailMessageId: smtpInfo.messageId,
        },
        $unset: { deliveryAttemptId: 1, deliveryLeaseExpiresAt: 1 },
      },
      { new: true }
    );
    if (!sentRecord) {
      const error = new Error('郵件已被伺服器接受，但寄送結果無法寫回');
      error.code = 'DELIVERY_RESULT_NOT_SAVED';
      throw error;
    }
    await logDelivery(record, 'sent', { recipient, messageId: smtpInfo.messageId, attemptId: deliveryAttemptId });

    res.json({
      status: 'finalized',
      deliveryStatus: sentRecord.deliveryStatus,
      sentAt: sentRecord.sentAt,
      sentTo: sentRecord.sentTo,
      messageId: sentRecord.emailMessageId,
      shareUrl: reportUrl,
      shareExpiresAt: activeShareExpiresAt,
    });
  } catch (err) {
    const response = mailErrorResponse(err);

    if (record?._id && deliveryAttemptId) {
      const outcomeUncertain = Boolean(smtpInfo) || isAmbiguousMailFailure(err, { smtpStarted });
      const nextStatus = outcomeUncertain ? 'uncertain' : 'failed';
      const deliveryError = outcomeUncertain
        ? smtpInfo
          ? '郵件伺服器可能已接受，但系統無法確認最後寫入結果；請先確認收件匣，避免重複寄送'
          : '寄送連線在郵件伺服器確認結果前中斷，郵件可能已送出；請先確認收件匣，避免重複寄送'
        : response?.message || '寄送失敗，請稍後重試';
      try {
        await MedicalRecord.updateOne(
          { _id: record._id, deliveryAttemptId },
          {
            $set: {
              deliveryStatus: nextStatus,
              deliveryError,
              ...(outcomeUncertain ? { sentTo: recipient } : {}),
              ...(smtpInfo?.messageId ? { emailMessageId: smtpInfo.messageId } : {}),
            },
            $unset: { deliveryAttemptId: 1, deliveryLeaseExpiresAt: 1 },
          }
        );
      } catch (saveError) {
        console.error('記錄寄送失敗狀態時發生錯誤', saveError);
      }
      await logDelivery(record, nextStatus === 'uncertain' ? 'uncertain' : 'failed', {
        recipient,
        messageId: smtpInfo?.messageId || '',
        error: deliveryError,
        attemptId: deliveryAttemptId,
      });
      if (outcomeUncertain) {
        return res.status(202).json({
          message: deliveryError,
          deliveryStatus: 'uncertain',
          sentTo: recipient,
          shareUrl: `${publicAppOrigin(req)}/report/${record.shareToken}`,
          shareExpiresAt: activeShareExpiresAt,
        });
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
    record.shareExpiresAt = null;
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

    const isInternalRender = hasPdfRenderAccess(req);
    // 舊資料沒有到期日也視為失效；院方重新分享時會補上新的期限。
    const shareExpired = !record.shareExpiresAt || record.shareExpiresAt <= new Date();
    if (!isInternalRender && (!record.shareEnabled || !isFinalizedRecord(record) || shareExpired)) {
      return res.status(410).json({ message: '這份報告的分享連結已失效' });
    }

    const sections = await sectionsForView(record);
    res.set('Cache-Control', 'private, no-store');
    res.json(reportPayload(record, sections));
  } catch (err) {
    next(err);
  }
});
