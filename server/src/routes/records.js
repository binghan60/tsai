import { Router } from 'express';
import mongoose from 'mongoose';
import FormTemplate from '../models/FormTemplate.js';
import MedicalRecord from '../models/MedicalRecord.js';
import Pet from '../models/Pet.js';
import Owner from '../models/Owner.js';
import Appointment from '../models/Appointment.js';
import { enqueueReportPdf, readStoredPdf, removePdf } from '../lib/reportPdfJobs.js';
import { encryptPdf } from '../lib/pdfEncrypt.js';
import { createFailureLimiter, reportPasscode, reportPasscodeMatches } from '../lib/reportPasscode.js';
import {
  autoSendRecipientProblem,
  claimDelivery,
  effectiveDeliveryStatus,
  isFinalizedRecord,
  performDelivery,
  shareExpiryFromNow,
} from '../lib/reportDelivery.js';
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
import { reportPdfFilename } from '../../../shared/reportFilename.js';
import { emitAppointmentUpdate } from '../lib/realtime.js';
import { applyVisitEdits, hasVisitEdits, stripVisitFields, templateLabItems, visitOverlay } from '../lib/recordVisitLink.js';
import { syncAppointmentJournal } from '../lib/appointmentJournal.js';
import { deskStatusByRecordId, hasNoVisitRecord, NO_VISIT_RECORD_MESSAGE, visitInfoForRecord } from '../lib/recordDeskStatus.js';
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
  // 已經存著、這次沒動的圖片不必重驗（讀出來的 customValues 是 Map，要用 get）。
  const stored = existingRecord?.customValues;
  const previous = (key) => (stored instanceof Map ? stored.get(key) : stored?.[key]);
  for (const key of imageKeys) {
    if (customValues[key] !== undefined && !sameImages(customValues[key], previous(key))) {
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

// 報告檢視要看的那份區塊結構。
//
// 已結案的一律直接用自己的快照，不再回頭補「上次數值」——快照的意義就是「結案當下的樣子」。
// 補登一份日期更早的報告會讓歷史往回長，那時再回頭加工，已經寄給飼主的報告重新開啟
// 就會多出當初 PDF 上沒有的對照欄，而 PDF 是每次重繪的，附件與線上版會對不起來。
// 順帶省下兩支查詢：補對照值要撈最多 20 份帶完整 sections 的報告，而公開報告頁
// 正是 Puppeteer 產 PDF 的來源，結案與寄信路徑上各會走一次。
//
// 草稿還沒凍結結構，仍要即時用目前範本組合並補上對照值。
// 報到建立的草稿連著一筆看診。體重、體溫、回診日期、檢驗數值只存在看診上，
// 讀草稿時把看診的值疊到文件上（只改記憶體裡這一份，不存回去），之後的組區塊、預覽都看得到。
const VISIT_SELECT = '_id date weightKg temperatureC followUpDate followUpTime labValues deskItems';
async function linkedVisitFor(record) {
  if (!record || record.status !== 'draft') return null;
  return Appointment.findOne({ recordId: record._id }).select(VISIT_SELECT).lean();
}
// 填寫頁靠 visitLink 知道連著哪一筆看診；noVisitRecord＝櫃台處理勾了「這次看診不寄就診紀錄」，醫師填寫時就看得到。
function visitLinkPayload(visit) {
  if (!visit) return null;
  return { appointmentId: visit._id, date: visit.date, noVisitRecord: (visit.deskItems ?? []).includes('no_visit_record') };
}
async function applyLinkedVisit(record, visit = undefined) {
  const linked = visit === undefined ? await linkedVisitFor(record) : visit;
  if (linked) record.set(visitOverlay(record, linked, await templateForRecord(record)));
  return linked;
}

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

// 檔名有中文（貓咪名），Content-Disposition 要用 RFC 5987 的 filename*；
// 舊式 filename= 只能放 ASCII，留一個英文後備給不認得 filename* 的用戶端。
function pdfContentDisposition(record) {
  const filename = reportPdfFilename({ petName: record.petId?.name, visitDate: record.visitDate });
  return `attachment; filename="health-report.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function reportPayload(record, sections) {
  const pet = record.petId;
  const owner = pet?.ownerId;
  return {
    // 臨床內容一律走這份區塊快照；報告頁不再讀 MedicalRecord 的具名欄位。
    sections,
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
          birthDateEstimated: pet.birthDateEstimated,
          vaccineStatus: pet.vaccineStatus,
          vaccineDate: pet.vaccineDate,
          medicalHistory: pet.medicalHistory,
          medicalHistoryOther: pet.medicalHistoryOther,
          allergyStatus: pet.allergyStatus,
          allergyType: pet.allergyType,
          checkupStatus: pet.checkupStatus,
          checkupDate: pet.checkupDate,
        }
      : null,
    owner: owner ? { name: owner.name } : null,
  };
}

// 掛載於 /api/pets/:petId/records
export const petRecordsRouter = Router({ mergeParams: true });
const PET_RECORD_LIST_FIELDS =
  'petId vet visitDate examType status deliveryStatus deliveryError reportVersion revisionOf revisionRootId supersededBy shareToken shareEnabled sharedAt shareExpiresAt sentAt sentTo finalizedAt updatedAt createdAt';

petRecordsRouter.get('/', async (req, res, next) => {
  try {
    const pagination = paginationOptions(req.query);
    // 貓咪頁只畫摘要，不能把每份報告的大型 sections 快照與全部臨床內容一起載回。
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

// 結案的租約鎖：程序中途消失時，超過這段時間別的請求才接手（寄送的在 lib/reportDelivery.js）。
const FINALIZE_LEASE_MS = 5 * 60 * 1000;

// ── 填表時的「上次數值」──
// 這隻貓咪過去每個項目最近一次的紀錄，不限健檢類型：只要以前量過血小板，
// 這次的表單有血小板就能顯示上次的值，即使兩次用的是不同的健檢表單。
// 只收得出數值的型別——理學檢查只有正常／異常，沒有可以拿來對照的數字；只看最近 20 份已結案報告（lib/historyValues.js）。
//
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
      // 遞增父文件 relationVersion，讓「建立報告」與「刪除貓咪／表單」無法同時提交。
      const pet = await Pet.findOneAndUpdate(
        { _id: req.params.petId },
        { $inc: { relationVersion: 1 } },
        { new: true, session }
      ).select('+relationVersion');
      if (!pet) {
        const error = new Error('找不到貓咪');
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

// 跨貓咪的健檢紀錄清單。存在的理由是「分發」這一端需要一個集散地：
// 儀錶板只給得出數字與最近幾筆，其餘報告過去只能一隻一隻貓咪翻進去找，
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
  'petId vet visitDate examType status deliveryStatus deliveryError reportVersion sentAt finalizedAt updatedAt createdAt';
const RECORD_LIST_POPULATE = {
  path: 'petId',
  select: 'name species ownerId',
  populate: { path: 'ownerId', select: 'name phone email' },
};

// 關鍵字可能指向貓咪或飼主，那是另外兩個 collection——先解析成 petId 清單，
// 再併進報告自己的欄位（獸醫師）一起比對。
async function petIdsMatching(pattern) {
  const owners = await Owner.find({ $or: [{ name: pattern }, { phone: pattern }, { landline: pattern }, { email: pattern }] }).select('_id');
  const ownerIds = owners.map((owner) => owner._id);
  const pets = await Pet.find({
    $or: [
      { name: pattern },
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

    // 櫃台處理狀態讓醫師看得出這筆看診櫃台做完了沒；報告沒連著看診時是空字串。
    const deskStatuses = await deskStatusByRecordId(items);
    const rows = items.map((item) => {
      const desk = deskStatuses.get(String(item._id));
      return {
        ...item.toJSON(),
        deskStatus: desk?.deskStatus ?? '',
        deskNoVisitRecord: Boolean(desk?.noVisitRecord),
        // 清單上的櫃台處理徽章點得進那次看診；沒有對應看診（獨立報告）是 null。
        deskVisit: desk?.visit ?? null,
      };
    });

    res.json({ items: rows, total, page, limit, view, counts });
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
    // 連著看診的草稿先疊上看診的值；填寫頁靠 visitLink 知道這幾欄改了會寫回看診。
    const visit = await applyLinkedVisit(record);
    // 預覽模式與報告頁共用同一套渲染，草稿也要能拿到區塊結構與歷史對照數值。
    const sections = await sectionsForView(record);
    // 對應看診（草稿、結案、修訂版都有；獨立報告是 null）：預覽頁的「對應看診」一條與寄送防呆都看這個。
    const visitInfo = await visitInfoForRecord(record);
    // 一定要用 toJSON()：toObject() 預設不 flatten Map，展開後 customValues 會變成 {}，
    // 自訂項目的作答一開啟編輯頁就空白，接著自動儲存把 {} 寫回資料庫。
    res.json({
      ...record.toJSON(),
      sections,
      deliveryStatus: effectiveDeliveryStatus(record),
      visitLink: visitLinkPayload(visit),
      // 櫃台勾了「這次看診不寄就診紀錄」：預覽頁停用 Email 寄送（伺服器也擋）。
      visitInfo,
      noVisitRecord: Boolean(visitInfo?.noVisitRecord),
    });
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
    let recordFields = sanitizeRecordImages(pickRecordFields(req.body), template, existingForValidation);
    // 連著看診的草稿：體重、體溫、回診日期、檢驗數值不存在報告上（送來的一律清掉），
    // 醫師在報告上改過的那幾欄由前端放在 visitEdits，同一個 transaction 裡寫回看診。
    const linkedVisit = await Appointment.findOne({ recordId: req.params.id }).select('_id');
    if (linkedVisit) recordFields = stripVisitFields(recordFields, template);
    const visitEdits = linkedVisit && hasVisitEdits(req.body.visitEdits) ? req.body.visitEdits : null;
    let record = null;
    let editedVisit = null;
    try {
      await withTransaction(async (session) => {
        editedVisit = null;
        if (visitEdits) {
          const appointment = await Appointment.findById(linkedVisit._id).session(session);
          const visitTemplate = appointment.templateId ? await FormTemplate.findById(appointment.templateId).session(session) : null;
          applyVisitEdits(appointment, visitEdits, templateLabItems(visitTemplate));
          appointment.increment();
          await appointment.save({ session });
          await syncAppointmentJournal(appointment, { session });
          editedVisit = appointment;
        }
        record = await MedicalRecord.findOneAndUpdate(
          {
            _id: req.params.id,
            status: 'draft',
            __v: expectedVersion,
            $or: [{ finalizeAttemptId: null }, { finalizeAttemptId: { $exists: false } }],
          },
          { $set: recordFields, $inc: { __v: 1 } },
          { new: true, runValidators: true, session }
        );
        // 報告寫不進去（版本衝突、已結案），看診那邊也不能改一半。
        if (!record) throw Object.assign(new Error('record not saved'), { recordNotSaved: true });
      });
    } catch (err) {
      if (!err.recordNotSaved) throw err;
      record = null;
    }
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
    if (editedVisit) emitAppointmentUpdate(editedVisit);
    // 回傳時一樣疊上看診的最新值：診療台剛改的數字，填寫頁存一次檔就看得到。
    const visit = linkedVisit ? await applyLinkedVisit(record) : null;
    res.json({ ...record.toJSON(), visitLink: visitLinkPayload(visit) });
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
    // 連著看診的草稿：結案這一刻把看診的值凍結進報告，之後看診再改也不影響已結案的報告。
    const linkedVisit = await linkedVisitFor(record);
    const frozenVisitFields = linkedVisit ? visitOverlay(record, linkedVisit, template) : {};
    if (linkedVisit) record.set(frozenVisitFields);
    const previousValues = await getPetPreviousValues(record.petId, record._id, record);
    const composedSections = enrichSectionsWithPreviousValues(composeReportSections(record, template), previousValues);

    const missing = validateFinalRecord(composedSections);
    if (missing.length) {
      return res.status(422).json({ message: `請先補齊：${missing.join('、')}` });
    }

    // 結案時勾了「PDF 產生後自動寄給飼主」：意圖記在報告上，PDF 背景工作產好就寄（lib/reportDelivery.js）。
    // 信箱有問題趁醫師還在畫面上就講；報告照樣結案，只是不排自動寄送。
    let autoSend = false;
    let autoSendError = '';
    if (req.body?.autoSend === true) {
      const problem = await hasNoVisitRecord(record) ? NO_VISIT_RECORD_MESSAGE : await autoSendRecipientProblem(record.petId);
      if (problem) autoSendError = `沒有自動寄出：${problem}`;
      else autoSend = true;
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
          ...frozenVisitFields,
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
    // Number(null) 與 Number('') 都是 0 —— 沒填體重時不能把貓咪的體重蓋成 0。
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
            autoSendRequestedAt: autoSend ? finalizedAt : null,
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
          const error = new Error('找不到報告所屬貓咪，無法完成結案');
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
      autoSendRequestedAt: record.autoSendRequestedAt ?? null,
      documentVersion: record.__v,
      ...(autoSendError ? { autoSendError } : {}),
    });
  } catch (err) {
    // 鎖定之後、真正結案之前出錯：把結案鎖放掉、退回草稿，使用者才能再試一次。
    if (record?._id && finalizeAttemptId && !didFinalize) {
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
    const record = await MedicalRecord.findById(req.params.id).select('+pdfFileId').populate({
      path: 'petId',
      select: 'name ownerId',
      populate: { path: 'ownerId', select: 'phone' },
    });
    if (!record) return res.status(404).json({ message: '找不到報告' });
    if (!isFinalizedRecord(record)) {
      return res.status(409).json({ message: '請先結案，再下載正式 PDF' });
    }
    if (record.pdfStatus !== 'ready') {
      return res.status(409).json({ message: record.pdfStatus === 'failed' ? 'PDF 產生失敗，請重試。' : 'PDF 正在產生中，完成後即可下載。' });
    }
    const storedPdf = await readStoredPdf(record);
    if (!storedPdf) return res.status(409).json({ message: 'PDF 正在準備中，請稍後再試。' });
    // 存著的是沒有密碼的原檔；下載的這份多半是要轉交給飼主的，所以跟 Email 附件一樣
    // 用飼主手機後 6 碼加密（見 lib/pdfEncrypt.js）。
    const pdfBuffer = await encryptPdf(storedPdf, reportPasscode(record.petId?.ownerId?.phone));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', pdfContentDisposition(record));
    res.send(pdfBuffer);
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
  let deletedPdfFileId = null;
  let unlinkedAppointmentIds = [];
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
    // 「捨棄剛剛開錯的草稿」要求先抄一次貓咪名，只會讓人開始無視這個確認。
    //
    // 確認方式仿 GitHub 刪除 repository：要求把一段文字原封不動打進來，
    // 防的是「手滑點到刪除又手滑點到確認」這種連續誤觸。
    // 比對的是貓咪名而不是報告編號——編號是一串記不住的亂碼，只能照抄，
    // 抄的過程不會讓人意識到自己在刪什麼；打出貓咪名則會。
    if (isFinalizedRecord(record)) {
      const pet = await Pet.findById(record.petId).select('name');
      const expected = String(pet?.name ?? '').trim();
      const confirmText = String(req.body?.confirmText ?? '').trim();
      if (!expected || confirmText !== expected) {
        return res.status(422).json({ message: '確認文字不符，請輸入完整的貓咪名稱' });
      }
    }
    // 修訂鏈回復與刪除必須一起成功；任何一步失敗就全部回滾。
    await withTransaction(async (session) => {
      const current = await MedicalRecord.findById(record._id).select('+pdfFileId').session(session);
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
      deletedPdfFileId = current.pdfFileId ?? null;
      // 報告可能在最初讀取與 transaction 開始之間剛好完成結案，
      // 因此確認文字必須用 transaction 內的最新狀態再驗一次。
      if (isFinalizedRecord(current)) {
        const currentPet = await Pet.findById(current.petId).select('name').session(session);
        if (!currentPet) {
          const error = new Error('找不到報告所屬貓咪，無法確認刪除');
          error.status = 409;
          throw error;
        }
        const confirmedName = String(req.body?.confirmText ?? '').trim();
        if (confirmedName !== String(currentPet.name ?? '').trim()) {
          const error = new Error('確認文字不符，請輸入完整的貓咪名稱');
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

      // 報到時建立的草稿綁在掛號的 recordId 上。不一起解除的話，診療台會拿著一個
      // 已不存在的 id「開啟表單草稿」，workflow/record 也會因找不到原綁定表單而 409。
      // 版本號一起遞增，開著舊畫面的工作區才不會拿舊的 recordId 蓋回去。
      const linked = await Appointment.find({ recordId: current._id }).select('_id').session(session);
      unlinkedAppointmentIds = linked.map((item) => item._id);
      if (unlinkedAppointmentIds.length) {
        await Appointment.updateMany(
          { _id: { $in: unlinkedAppointmentIds } },
          { $set: { recordId: null }, $inc: { __v: 1 } },
          { session }
        );
      }
    });
    if (unlinkedAppointmentIds.length) {
      const appointments = await Appointment.find({ _id: { $in: unlinkedAppointmentIds } });
      appointments.forEach((appointment) => emitAppointmentUpdate(appointment));
    }
    await cleanUpImages(deletedImageIds, `record ${req.params.id} deleted`);
    // 已結案報告存著的 PDF 原檔一起清掉：報告刪了，它的內容不該還留在資料庫裡。
    await removePdf(deletedPdfFileId);
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

recordsRouter.post('/:id/send-email', async (req, res, next) => {
  try {
    const claim = await claimDelivery(req.params.id);
    if (claim.response) return res.status(claim.response.status).json(claim.response.body);
    const result = await performDelivery(claim.delivery, () => publicAppOrigin(req));
    res.status(result.status).json(result.body);
  } catch (err) {
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

// 同一個分享連結 15 分鐘內最多打錯 10 次。
const passcodeFailures = createFailureLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

publicReportsRouter.get('/:token', async (req, res, next) => {
  try {
    const record = await MedicalRecord.findOne({ shareToken: req.params.token }).populate({
      path: 'petId',
      populate: { path: 'ownerId', select: 'name phone' },
    });
    if (!record) return res.status(404).json({ message: '找不到這份報告，連結可能已失效' });

    const isInternalRender = hasPdfRenderAccess(req);
    // 舊資料沒有到期日也視為失效；院方重新分享時會補上新的期限。
    const shareExpired = !record.shareExpiresAt || record.shareExpiresAt <= new Date();
    if (!isInternalRender && (!record.shareEnabled || !isFinalizedRecord(record) || shareExpired)) {
      return res.status(410).json({ message: '這份報告的分享連結已失效' });
    }

    // 連結之外再要一道密碼（飼主手機後 6 碼）：連結被轉寄或貼錯對象時，報告內容不會跟著外流。
    // 密碼放在標頭、不放網址，才不會留在瀏覽紀錄與存取紀錄裡。產 PDF 的內部渲染不必帶。
    const passcode = isInternalRender ? '' : reportPasscode(record.petId?.ownerId?.phone);
    if (passcode) {
      const retryAfter = passcodeFailures.retryAfterSeconds(record.shareToken);
      if (retryAfter) {
        res.set('Retry-After', String(retryAfter));
        return res.status(429).json({ message: '密碼錯誤次數過多，請稍後再試', passcodeRequired: true });
      }
      const supplied = req.get('x-report-passcode');
      if (!supplied) return res.status(401).json({ message: '請輸入密碼', passcodeRequired: true });
      if (!reportPasscodeMatches(supplied, passcode)) {
        passcodeFailures.fail(record.shareToken);
        return res.status(401).json({ message: '密碼不正確，請再確認一次', passcodeRequired: true });
      }
    }

    const sections = await sectionsForView(record);
    res.set('Cache-Control', 'private, no-store');
    res.json(reportPayload(record, sections));
  } catch (err) {
    next(err);
  }
});
