import { Router } from 'express';
import { randomInt } from 'node:crypto';
import mongoose from 'mongoose';
import Appointment from '../models/Appointment.js';
import Pet from '../models/Pet.js';
import Owner from '../models/Owner.js';
import FormTemplate from '../models/FormTemplate.js';
import ClinicSettings from '../models/ClinicSettings.js';
import MedicalRecord from '../models/MedicalRecord.js';
import { defaultRecordFields } from '../lib/formTemplate.js';
import { visitOverlay } from '../lib/recordVisitLink.js';
import { withTransaction } from '../lib/transaction.js';
import { clinicToday, combineClinicDateTime } from '../lib/clinicTime.js';
import { depositFieldsForBooking, settleCarriedDeposit } from '../lib/deposit.js';
import { DEPOSIT_CANCEL_OUTCOMES, checkDepositEdit } from '../../../shared/deposit.js';
import { canTransitionAppointmentStatus, describeAppointmentTransition, holdsCheckinNumber } from '../lib/appointmentStatus.js';
import { nextAvailableCheckinNumber } from '../lib/appointmentQueue.js';
import { emitAppointmentUpdate, emitClinicalNoteUpdate, emitLabResultsUpdate, emitMedicationUpdate } from '../lib/realtime.js';
import { syncAppointmentJournal } from '../lib/appointmentJournal.js';
import { restoreImageUploadTodo, withdrawImageUploadTodo } from '../lib/imageUploadTodo.js';
import { publishTodos } from '../lib/todos.js';
import ClinicalNote from '../models/ClinicalNote.js';
import { cancelVisitMedicationOrder } from '../lib/visitMedicationOrder.js';
import { queueIdexxCensus } from '../lib/idexxRequests.js';
import { applyPendingLabResults, releaseLabResults } from '../lib/labResultApply.js';
import LabResult from '../models/LabResult.js';
import { canRequestLab } from '../lib/idexxCensus.js';
import { idexxCensusSettings } from '../config/idexxBridge.js';
import appointmentWorkflowRouter from './appointmentWorkflow.js';
import { APPOINTMENT_TIME_ERROR, isValidAppointmentTime, normalizeEstimatedDuration, normalizeSurgeryFields, validateAppointmentDuration } from '../lib/appointmentTime.js';
import { checkMobilePhone } from '../../../shared/phone.js';
import { escapeRegExp } from '../lib/regex.js';
import { paginatedPayload, paginationOptions } from '../lib/pagination.js';

const router = Router();
router.use('/:id/workflow', appointmentWorkflowRouter);

// 開著舊分頁的裝置不能覆寫別人剛做的事：版本不符一律擋下。
// 另外，已經開始看診（或已交櫃台、已完成）的掛號不接受取消報到／取消／未到——
// 那些是排班動作，人都已經在診間裡了就不該再走那條路；要取消得先由醫師「取消看診」退回候診
// （workflow 的 unstart），已交櫃台的要先取回。
function checkWorkflowCompatibility(appointment, path, version) {
  if (version !== undefined && version !== (appointment.__v ?? 0)) {
    throw Object.assign(new Error('掛號資料已更新，請重新載入後再確認'), { status: 409 });
  }
  const action = path.split('/').at(-1);
  const started = appointment.visitStartedAt || appointment.handoffAt || appointment.deskCompletedAt;
  if (['cancel', 'restore', 'no-show'].includes(action) && started) {
    throw Object.assign(new Error('此就診已開始處理，不能取消報到或標記未到'), { status: 422 });
  }
}

const EDITABLE_APPOINTMENT_FIELDS = ['date', 'time', 'estimatedDurationMinutes', 'reason', 'petName', 'ownerName', 'ownerPhone', 'species', 'templateId', 'isSurgery', 'surgeryName'];
const EDITABLE_APPOINTMENT_STATUSES = new Set(['scheduled', 'arrived']);

// 初診掛號發給飼主的 4 位驗證碼：飼主用它在公開初診頁（/intake）填資料。
function newIntakeVerificationCode() {
  return String(randomInt(1000, 10000));
}

// 掛號要用哪一份健檢表單：有指定就用指定的，沒有就用設定的預設表單。
// optional：沒指定、也還沒設預設表單時回 null（新增掛號時可以先不決定，報到時才需要）。

async function resolveAppointmentTemplate(templateId, { optional = false } = {}) {
  const selectedId = templateId || (await ClinicSettings.findOne().lean())?.defaultAppointmentTemplateId;
  if (!selectedId) {
    if (optional) return null;
    const error = new Error('請先在表單管理設定預設表單，或在掛號時選擇表單');
    error.status = 422;
    throw error;
  }
  if (!mongoose.isValidObjectId(selectedId)) {
    const error = new Error('表單格式不正確');
    error.status = 422;
    throw error;
  }
  const template = await FormTemplate.findOne({ _id: selectedId, enabled: { $ne: false } });
  if (!template) {
    const error = new Error('找不到指定表單，或該表單已停用');
    error.status = 422;
    throw error;
  }
  return template;
}

// 報到時替這次看診建立健檢報告草稿。沒有可用的表單就擋下報到並說明要去哪裡改——
// 少了草稿，檢驗數值與量測沒有報告可以帶入。
async function createCheckinRecord(appointment, session) {
  if (appointment.recordId) return;

  const settings = appointment.templateId
    ? null
    : await ClinicSettings.findOne().session(session);
  const selectedId = appointment.templateId || settings?.defaultAppointmentTemplateId;
  if (!mongoose.isValidObjectId(selectedId)) {
    const error = new Error('請先在表單管理設定預設表單，或在掛號時選擇表單');
    error.status = 422;
    throw error;
  }
  const template = await FormTemplate.findOne({ _id: selectedId, enabled: { $ne: false } }).session(session);
  if (!template) {
    const error = new Error('指定的表單不存在或已停用，請更換表單後再報到');
    error.status = 422;
    throw error;
  }

  // 草稿不存體重、體溫、回診日期、檢驗數值，讀取時直接引用這次看診（lib/recordVisitLink.js）。
  const [record] = await MedicalRecord.create([{
    petId: appointment.petId,
    ...defaultRecordFields(template),
    visitDate: combineClinicDateTime(appointment.date, appointment.time || '10:00'),
    chiefComplaint: appointment.reason,
    templateId: template._id,
    templateVersion: template.version,
    examType: template.name,
  }], { session });
  appointment.recordId = record._id;
  appointment.templateId = template._id;
}

// 當日曾經發出去的牌號都算已使用，包含仍在候診的 current number 與已歸還／改號的 history。
function appointmentsWithIssuedNumbers(date, session) {
  return Appointment.find({
    date,
    $or: [
      { checkinNumber: { $type: 'number' } },
      { 'checkinNumberHistory.0': { $exists: true } },
    ],
  }).session(session);
}

function rememberCheckinNumber(appointment, number) {
  if (!Number.isSafeInteger(number) || number < 1) return;
  const history = Array.from(appointment.checkinNumberHistory ?? []);
  if (!history.includes(number)) history.push(number);
  appointment.checkinNumberHistory = history;
}

// 藥單異動軌跡上的取消原因：看診是怎麼離開流程的（離開後的狀態）。
const LEAVE_REASONS = { cancelled: '掛號已取消', no_show: '掛號標記未到', scheduled: '已取消報到' };

// 實體號碼牌只屬於持牌者；離開候診時歸還這張牌，不改動任何其他人的牌號。
// 歸還前先寫入 history，確保同一天不會再次配發這個已叫過的號碼。
async function saveLeavingQueue(appointment, wasQueued, session = null) {
  if (wasQueued) rememberCheckinNumber(appointment, appointment.checkinNumber);
  if (wasQueued || appointment.checkinNumber != null) appointment.checkinNumber = null;
  // 離開候診＝這次的送 IDEXX也作廢，再次報到時不會自己又送一次。
  appointment.labRequestedAt = null;
  // 診療台開的藥單也一併取消：這次看診沒有成立，櫃台不該照著包藥（已領藥的不動）。
  const cancelledOrder = await cancelVisitMedicationOrder(appointment, LEAVE_REASONS[appointment.status] ?? '', { session });
  // 還沒做的「上傳影像」待辦也收掉（已完成的留著）。
  const todosChanged = await withdrawImageUploadTodo(appointment, { session });
  await appointment.save(session ? { session } : undefined);
  if (todosChanged) await publishTodos();
  // 看診沒有成立就不留在病歷：日誌只是連結，內容還在掛號上，重新報到後會回來（lib/appointmentJournal.js）。
  await syncAppointmentJournal(appointment, { session });
  if (appointment.petId) emitClinicalNoteUpdate({ petId: appointment.petId, appointmentId: appointment._id });
  if (cancelledOrder) emitMedicationUpdate(cancelledOrder);
}

// 回診掛號（followUpOfId 指向約它的那次看診）被取消或刪除：那次看診回到「待安排回診」，櫃台處理視窗才能重新約；
// 取消的回診被恢復時接回去（那次看診這段期間沒有另外約新的才接）。不是誰在編輯那次看診，但 __v 要往前——
// 開著它的處理視窗手上的版本已經過時。
async function syncFollowUpParent(followUp, { linked }) {
  if (!followUp.followUpOfId) return;
  const parent = await Appointment.findOneAndUpdate(
    { _id: followUp.followUpOfId, followUpAppointmentId: linked ? null : followUp._id },
    {
      $set: linked
        ? { followUpAppointmentId: followUp._id, followUpDate: followUp.date, followUpTime: followUp.time }
        : { followUpAppointmentId: null, followUpDate: '', followUpTime: '' },
      $inc: { __v: 1 },
    },
    { new: true },
  );
  if (parent) emitAppointmentUpdate(parent);
}

// GET /api/appointments?date=YYYY-MM-DD（預設今天）
// 目前畫面只做單日時間軸，量不大，直接回傳當天全部，不分頁。
// 診療台的佇列要一眼看到「這隻會咬人」「這位飼主要小心應對」，而那兩段備註存在
// Pet／Owner 主檔上、不在掛號快照裡。另外回一份以 id 為鍵的對照表，而不是塞進每筆
// 掛號——即時廣播的 appointment:updated 只帶掛號本身，塞進去的欄位會在下一次廣播時被洗掉。
async function patientNotesFor(appointments) {
  const idsOf = (key) => [...new Set(appointments.map((item) => item[key]).filter((id) => mongoose.isValidObjectId(id)).map(String))];
  const petIds = idsOf('petId');
  const ownerIds = idsOf('ownerId');
  const [pets, owners] = await Promise.all([
    petIds.length ? Pet.find({ _id: { $in: petIds } }).select('notes').lean() : [],
    ownerIds.length ? Owner.find({ _id: { $in: ownerIds } }).select('notes').lean() : [],
  ]);
  const toMap = (docs) => Object.fromEntries(docs.filter((doc) => doc.notes?.trim()).map((doc) => [String(doc._id), doc.notes.trim()]));
  return { pets: toMap(pets), owners: toMap(owners) };
}

// 每筆掛號連到幾份 IDEXX 檢驗結果：診療台左欄標「檢驗已出」用。跟備註一樣另外回一份對照表，不塞進掛號。
async function labResultCountsFor(appointments) {
  if (!appointments.length) return {};
  const results = await LabResult.find({ appointmentId: { $in: appointments.map((item) => item._id) } }).select('appointmentId').lean();
  const counts = {};
  for (const result of results) counts[String(result.appointmentId)] = (counts[String(result.appointmentId)] ?? 0) + 1;
  return counts;
}

router.get('/', async (req, res, next) => {
  try {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : clinicToday();
    const items = await Appointment.find({ date }).sort({ scheduledAt: 1, createdAt: 1 });
    const [patientNotes, labResultCounts] = await Promise.all([patientNotesFor(items), labResultCountsFor(items)]);
    res.json({ items, date, patientNotes, labResultCounts });
  } catch (err) {
    next(err);
  }
});

// GET /api/appointments/search?q=&page=&limit=
// 掛號台的跨日搜尋：電話裡問「我約哪一天」「上次什麼時候來的」時不知道日期，沒辦法一天一天翻。
// 找的是掛號不是貓——掛號比貓少得多，同名也少。不分日期、新到舊一條清單（還沒到的排最上面）、分頁；
// 取消與未到的也列出來（「我約的還在嗎」）。沿著 scheduledAt 索引掃再比對文字，會掃過全部掛號。
export function appointmentSearchFilter(q) {
  const pattern = new RegExp(escapeRegExp(q), 'i');
  return { $or: [{ petName: pattern }, { ownerName: pattern }, { ownerPhone: pattern }, { reason: pattern }] };
}

router.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    const pagination = paginationOptions(req.query, { defaultLimit: 10, maxLimit: 50 });
    if (!q) return res.json(paginatedPayload([], 0, pagination));
    const filter = appointmentSearchFilter(q);
    const [items, total] = await Promise.all([
      Appointment.find(filter).sort({ scheduledAt: -1, _id: -1 }).skip(pagination.skip).limit(pagination.limit),
      Appointment.countDocuments(filter),
    ]);
    res.json(paginatedPayload(items, total, pagination));
  } catch (err) {
    next(err);
  }
});

// GET /api/appointments/intake-codes
// 已發出、飼主還能用的初診驗證碼（條件跟公開初診頁驗證時一致，見 routes/intakeSubmissions.js），
// 不分日期——電話裡掛明天的初診也會先拿到碼。給初診面板管理用，不必去時間軸逐天找。
router.get('/intake-codes', async (req, res, next) => {
  try {
    const items = await Appointment.find({
      intakeVerificationExpiresAt: { $gt: new Date() },
      intakeVerificationCode: { $ne: '' },
      intakeVerificationUsedAt: null,
      intakeSubmissionId: null,
      visitType: 'new',
      petId: null,
      status: { $in: ['scheduled', 'arrived'] },
    }).sort({ createdAt: -1 }).limit(100);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { reason, petId } = req.body;
    const time = String(req.body.time || '').trim();
    if (!isValidAppointmentTime(time)) return res.status(422).json({ message: APPOINTMENT_TIME_ERROR });
    let ownerId = null;
    let ownerName;
    let ownerPhone;
    let petName;
    let species;

    if (petId !== undefined && petId !== null && petId !== '') {
      // 回診：不信任前端傳來的快照欄位，一律用資料庫當下的資料覆寫，避免快照與實際病患對不上。
      if (!mongoose.isValidObjectId(petId)) return res.status(422).json({ message: '貓咪編號格式不正確' });
      const pet = await Pet.findById(petId).populate('ownerId', 'name phone');
      if (!pet) return res.status(422).json({ message: '找不到指定的貓咪' });
      ownerId = pet.ownerId?._id ?? null;
      ownerName = pet.ownerId?.name ?? '';
      ownerPhone = pet.ownerId?.phone ?? '';
      petName = pet.name;
      species = pet.species;
    } else {
      // 初診：身分尚未確定，先存文字快照，報到時才正式建檔。
      ownerName = String(req.body.ownerName || '').trim();
      // 電話選填，但填了就要是手機（報到時會拿它建立飼主）。
      const checkedPhone = checkMobilePhone(req.body.ownerPhone);
      if (checkedPhone.error) return res.status(422).json({ message: checkedPhone.error });
      ownerPhone = checkedPhone.phone;
      petName = String(req.body.petName || '').trim();
      species = String(req.body.species || '').trim();
      if (req.body.ownerId !== undefined && req.body.ownerId !== null && req.body.ownerId !== '') {
        if (!mongoose.isValidObjectId(req.body.ownerId)) return res.status(422).json({ message: '飼主編號格式不正確' });
        const owner = await Owner.findById(req.body.ownerId);
        if (!owner) return res.status(422).json({ message: '找不到指定的飼主' });
        ownerId = owner._id;
        ownerName = owner.name;
        ownerPhone = owner.phone;
      }
    }

    // 飼主姓名選填（電話掛號時常常只問得到貓咪名），但一筆掛號至少要指得出是誰要來。
    // 回診的 petName 抄自 Pet.name、必定有值，所以這一條實際上只會擋到初診。
    if (!petName) return res.status(422).json({ message: '請填寫貓咪姓名' });

    // 電話掛號時客人常常是說「我明天帶來」，所以日期可以指定；沒帶就是今天。
    // 這頁仍然一次只看一天（時間軸與候診佇列都以 date 為界），不做跨日排班。
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.date || '')) ? req.body.date : clinicToday();
    // 沒指定時段時，排序基準要落在掛號的那一天，不是「現在」——
    // 掛明天卻拿到今天的時刻，會讓那筆排到明天清單的最前面。只有掛今天才用當下時間，
    // 那代表「現在打電話來、等一下就到」。跟 PUT 的處理保持一致。
    const scheduledAt = time
      ? combineClinicDateTime(date, time)
      : date === clinicToday()
        ? new Date()
        : combineClinicDateTime(date, '');

    const template = await resolveAppointmentTemplate(req.body.templateId, { optional: true });
    const { isSurgery, surgeryName } = normalizeSurgeryFields(req.body);
    const estimatedDurationMinutes = normalizeEstimatedDuration(req.body.estimatedDurationMinutes);
    validateAppointmentDuration(time, estimatedDurationMinutes);
    // 這隻貓遲到／未到達到門檻時，要先決定保證金（已收或這次不收）才約得成；初診還沒有貓，不適用。
    // 之前取消掛號時留在診所的保證金會直接沿用到這一筆（carriedFromId），不再收一次。
    const deposit = await depositFieldsForBooking(petId || null, req.body.deposit);
    const appointment = await Appointment.create({
      ...deposit.fields,
      date,
      time: time || '',
      estimatedDurationMinutes,
      scheduledAt,
      ownerId,
      petId: petId || null,
      // 由後端依「掛號時是否已連結既有病患」決定，不採信呼叫端自報的類型。
      visitType: petId ? 'return' : 'new',
      ownerName,
      ownerPhone,
      petName,
      species,
      reason: reason || '',
      isSurgery,
      surgeryName,
      internalNote: String(req.body.internalNote || '').trim(),
      templateId: template?._id || null,
      intakeVerificationCode: petId ? '' : newIntakeVerificationCode(),
      intakeVerificationExpiresAt: petId ? null : new Date(scheduledAt.getTime() + 24 * 60 * 60 * 1000),
    });
    await settleCarriedDeposit(deposit.carriedFromId);
    emitAppointmentUpdate(appointment);
    res.status(201).json(appointment);
    await applyPendingLabResults(appointment);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: '找不到掛號' });
    res.json(appointment);
  } catch (err) {
    next(err);
  }
});

// 修改掛號：只有待報到與在院的改得動（時段、來院原因、身分快照、表單、手術標記）；已報到的不能改日期。
router.put('/:id', async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: '找不到掛號' });
    checkWorkflowCompatibility(appointment, req.path, req.body?.version);
    const previousDate = appointment.date;

    if (EDITABLE_APPOINTMENT_STATUSES.has(appointment.status)) {
      const updates = {};
      for (const field of EDITABLE_APPOINTMENT_FIELDS) {
        if (req.body[field] !== undefined) updates[field] = req.body[field];
      }
      // 已報到的人就在診所裡：改日期會讓這筆帶著今天的報到與號碼牌搬到別天。
      if (appointment.status === 'arrived' && updates.date !== undefined && updates.date !== appointment.date) {
        return res.status(422).json({ message: '已報到的掛號不能改日期，請先取消報到' });
      }
      if (updates.time !== undefined) {
        const time = String(updates.time || '').trim();
        updates.time = time;
        if (!isValidAppointmentTime(time)) return res.status(422).json({ message: APPOINTMENT_TIME_ERROR });
      }
      const duration = updates.estimatedDurationMinutes !== undefined
        ? normalizeEstimatedDuration(updates.estimatedDurationMinutes)
        : normalizeEstimatedDuration(appointment.estimatedDurationMinutes);
      updates.estimatedDurationMinutes = duration;
      validateAppointmentDuration(updates.time !== undefined ? updates.time : appointment.time, duration);
      if (updates.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(updates.date))) {
        return res.status(422).json({ message: '請填寫預約日期' });
      }
      if (updates.petName !== undefined && !String(updates.petName).trim()) {
        return res.status(422).json({ message: '請填寫貓咪姓名' });
      }
      if (updates.ownerPhone !== undefined) {
        // 回診掛號的電話抄自飼主資料，可能是舊系統的市話；沒改動就照收。
        const checkedPhone = checkMobilePhone(updates.ownerPhone, appointment.ownerPhone);
        if (checkedPhone.error) return res.status(422).json({ message: checkedPhone.error });
        updates.ownerPhone = checkedPhone.phone;
      }
      if (updates.templateId !== undefined) {
        const template = await resolveAppointmentTemplate(updates.templateId);
        // 報到時已經用原本的表單建好健檢報告草稿：換表單的話，看診的檢驗數值與草稿的表單結構會對不上。
        if (appointment.recordId && String(template._id) !== String(appointment.templateId)) {
          return res.status(422).json({ message: '這次看診已經建立健檢報告草稿，表單不能再換' });
        }
        updates.templateId = template._id;
      }
      if (updates.isSurgery !== undefined || updates.surgeryName !== undefined) {
        const merged = normalizeSurgeryFields({
          isSurgery: updates.isSurgery ?? appointment.isSurgery,
          surgeryName: updates.surgeryName ?? appointment.surgeryName,
        });
        updates.isSurgery = merged.isSurgery;
        updates.surgeryName = merged.surgeryName;
      }
      Object.assign(appointment, updates);
      const nextTime = updates.time ?? appointment.time;
      if (updates.time !== undefined || updates.date !== undefined) {
        appointment.scheduledAt = nextTime
          ? combineClinicDateTime(appointment.date, nextTime)
          : appointment.date === clinicToday()
            ? new Date()
            : combineClinicDateTime(appointment.date, '');
        // 初診的驗證碼在預約時間後 24 小時失效：掛號改到別天，期限要跟著移，不然到了那天驗證碼早就不能用。
        if (!appointment.petId && appointment.intakeVerificationCode && !appointment.intakeVerificationUsedAt) {
          appointment.intakeVerificationExpiresAt = new Date(appointment.scheduledAt.getTime() + 24 * 60 * 60 * 1000);
        }
      }
    } else {
      // 改不動的就明講，不要什麼都沒改卻回成功。
      return res.status(409).json({ message: '只有待報到與在院的掛號可以修改' });
    }

    await appointment.save();
    emitAppointmentUpdate(appointment, previousDate);
    res.json(appointment);
    await applyPendingLabResults(appointment);
  } catch (err) {
    next(err);
  }
});

// scheduled → arrived。只有已經建檔的貓能報到：初診要先由飼主填初診表、櫃台審核通過（那一步建立飼主與貓咪，
// 見 routes/intakeSubmissions.js 的 approve），掛號上才有 petId。
router.post('/:id/check-in', async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: '找不到掛號' });
    checkWorkflowCompatibility(appointment, req.path, req.body?.version);
    if (!canTransitionAppointmentStatus(appointment.status, 'arrived')) {
      return res.status(422).json({ message: describeAppointmentTransition(appointment.status, 'arrived') });
    }
    // 報到＝人現在到了：只能替今天的掛號報到，別天的要先把掛號改到今天。
    if (appointment.date !== clinicToday()) {
      return res.status(422).json({ message: '只能替今天的掛號報到；要今天看診請先把掛號改到今天' });
    }
    if (!appointment.petId) {
      return res.status(409).json({ message: '這筆初診還沒有建檔：請先讓飼主填初診表並完成審核，再報到' });
    }

    const isLate = Boolean(req.body?.isLate);
    const scheduledAt = new Date(appointment.scheduledAt);
    const lateAt = String(req.body?.lateAt || '');
    if (isLate && lateAt && !/^\d{2}:\d{2}$/.test(lateAt)) return res.status(422).json({ message: '實際到院時間格式不正確' });
    const suppliedNumber = req.body?.checkinNumber;
    const hasSuppliedNumber = suppliedNumber !== undefined && suppliedNumber !== null && String(suppliedNumber).trim() !== '';
    const requestedCheckinNumber = hasSuppliedNumber ? Number(suppliedNumber) : null;
    if (hasSuppliedNumber && (!Number.isSafeInteger(requestedCheckinNumber) || requestedCheckinNumber < 1)) {
      return res.status(422).json({ message: '號碼牌必須是從 1 開始的整數' });
    }
    const arrivalAt = isLate && lateAt ? combineClinicDateTime(appointment.date, lateAt) : new Date();
    const latenessMinutes = isLate && !Number.isNaN(scheduledAt.getTime())
      ? Math.max(0, Math.floor((arrivalAt.getTime() - scheduledAt.getTime()) / 60000))
      : 0;
    if (isLate && latenessMinutes < 1) return res.status(422).json({ message: '尚未超過預約時間，請使用一般報到' });
    const originalNumberHistory = Array.from(appointment.checkinNumberHistory ?? []);
    const originalRecordId = appointment.recordId;
    const originalImageTodoId = appointment.imageUploadTodoId;
    let todosRestored = false;
    await withTransaction(async (session) => {
      // transaction 可能被資料庫驅動程式整段重試：上一輪寫在記憶體裡的候選號、草稿與待辦 id 要先還原。
      appointment.checkinNumberHistory = [...originalNumberHistory];
      appointment.recordId = originalRecordId;
      appointment.imageUploadTodoId = originalImageTodoId;

      // 表單草稿在報到時建立，醫師進入診療台時已可直接編輯。
      await createCheckinRecord(appointment, session);

      // 報到時配一張今天從未發出過的實體號碼牌。候診先後仍由 checkedInAt 決定，
      // 所以這個數字之後即使人工修改，也不會改變誰先看診。
      const issuedAppointments = await appointmentsWithIssuedNumbers(appointment.date, session);
      appointment.status = 'arrived';
      appointment.checkedInAt = new Date();
      appointment.latenessMinutes = latenessMinutes;
      appointment.checkinNumber = hasSuppliedNumber ? requestedCheckinNumber : nextAvailableCheckinNumber(issuedAppointments);
      rememberCheckinNumber(appointment, appointment.checkinNumber);
      // 取消報到時收掉的「上傳影像」待辦，勾選還在就補回來。
      todosRestored = await restoreImageUploadTodo(appointment, { session });
      await appointment.save({ session });
      // 取消報到時拿掉的日誌，重新報到後接回來（先前寫的內容還在掛號上）。
      await syncAppointmentJournal(appointment, { session });
    });
    if (todosRestored) await publishTodos();

    // 報到讓這筆掛號進入候診佇列，診療台要立刻看到，不必等下一次輪詢。
    emitAppointmentUpdate(appointment);
    res.json(appointment);
    await applyPendingLabResults(appointment);
  } catch (err) { next(err); }
});

// 送 IDEXX／取消送 IDEXX：這一刻才把貓咪送到 IDEXX 主機的待驗清單（報到不自動送，不是每次看診都驗血）。
// body { requested: true|false, version }。只有在院內（已報到、櫃台還沒完成）而且已建檔的掛號能送；
// 伺服器沒開 IDEXX_CENSUS_MODE 時回 409——按鈕本來就不該出現（GET /lab-results/bridge-status 的 labRequest.enabled）。
router.post('/:id/lab-request', async (req, res, next) => {
  try {
    if (idexxCensusSettings().mode === 'off') return res.status(409).json({ message: '系統尚未開啟送 IDEXX 的功能' });
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: '找不到掛號' });
    checkWorkflowCompatibility(appointment, req.path, req.body?.version);
    const requested = req.body?.requested !== false;
    if (requested && !canRequestLab(appointment)) {
      return res.status(422).json({ message: '報到之後、櫃台完成處理之前才能送 IDEXX' });
    }
    // 重複按不重設時間，也不會重送（queueIdexxCensus 看上一份送了什麼）。
    if (requested && !appointment.labRequestedAt) appointment.labRequestedAt = new Date();
    if (!requested) appointment.labRequestedAt = null;
    await appointment.save();
    await queueIdexxCensus(appointment);
    emitAppointmentUpdate(appointment);
    res.json(appointment);
  } catch (err) { next(err); }
});

// 事後更正這筆掛號的保證金紀錄（貓咪詳情頁「出席紀錄」）：收錯、漏記、後來才退。
// 不看掛號的流程階段——這是更正紀錄，完成或取消的掛號照樣改得動；也不帶版本，保證金欄位跟看診內容無關。
// 改成已收而原本不是，決定時間記現在（次數從這一刻歸零）；原本就是已收的不動時間。
router.patch('/:id/deposit', async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: '找不到掛號' });
    if (!appointment.petId) return res.status(422).json({ message: '這筆掛號還沒有建檔的貓咪，沒有保證金紀錄可改' });
    if (appointment.depositStatus === 'carried') return res.status(409).json({ message: '這筆保證金已經沿用到下一筆掛號，請改那一筆' });
    const edit = checkDepositEdit(req.body);
    if (edit.error) return res.status(422).json({ message: edit.error });
    if (edit.status !== appointment.depositStatus) {
      appointment.depositDecidedAt = edit.status ? (edit.status === 'collected' || !appointment.depositDecidedAt ? new Date() : appointment.depositDecidedAt) : null;
    }
    appointment.depositStatus = edit.status;
    appointment.depositWaiveReason = edit.reason;
    await appointment.save();
    emitAppointmentUpdate(appointment);
    res.json(appointment);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/cancel', async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: '找不到掛號' });
    checkWorkflowCompatibility(appointment, req.path, req.body?.version);
    if (!canTransitionAppointmentStatus(appointment.status, 'cancelled')) {
      return res.status(422).json({ message: describeAppointmentTransition(appointment.status, 'cancelled') });
    }
    // 取消的可能是已報到、還在候診的那一筆：歸還號碼牌。
    const wasQueued = holdsCheckinNumber(appointment.status);
    // 這筆掛號收過保證金：取消時要說這筆錢的去向。先留著＝維持已收，下次約診沿用；
    // 已退還＝改記 refunded，次數不再從這筆歸零，下次約診照樣要求收（見 lib/deposit.js）。
    if (appointment.depositStatus === 'collected') {
      const outcome = req.body?.depositOutcome;
      if (!DEPOSIT_CANCEL_OUTCOMES.includes(outcome)) {
        return res.status(422).json({ message: '這筆掛號已收保證金，請選擇保證金先留著或已退還', depositOutcomeRequired: true });
      }
      if (outcome === 'refunded') appointment.depositStatus = 'refunded';
    }
    appointment.status = 'cancelled';
    appointment.cancelledAt = new Date();
    appointment.cancelReason = String(req.body?.cancelReason || '').trim();
    appointment.checkedInAt = null;
    await saveLeavingQueue(appointment, wasQueued);
    if (await releaseLabResults({ appointmentId: appointment._id })) emitLabResultsUpdate();
    await syncFollowUpParent(appointment, { linked: false });
    await queueIdexxCensus(appointment);
    emitAppointmentUpdate(appointment);
    res.json(appointment);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/no-show', async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: '找不到掛號' });
    checkWorkflowCompatibility(appointment, req.path, req.body?.version);
    if (!canTransitionAppointmentStatus(appointment.status, 'no_show')) {
      return res.status(422).json({ message: describeAppointmentTransition(appointment.status, 'no_show') });
    }
    appointment.status = 'no_show';
    appointment.checkedInAt = null;
    await saveLeavingQueue(appointment, false);
    if (await releaseLabResults({ appointmentId: appointment._id })) emitLabResultsUpdate();
    await queueIdexxCensus(appointment);
    emitAppointmentUpdate(appointment);
    res.json(appointment);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/restore', async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: '找不到掛號' });
    checkWorkflowCompatibility(appointment, req.path, req.body?.version);
    if (!canTransitionAppointmentStatus(appointment.status, 'scheduled')) {
      return res.status(422).json({ message: describeAppointmentTransition(appointment.status, 'scheduled') });
    }
    const wasQueued = appointment.status === 'arrived';
    appointment.status = 'scheduled';
    appointment.cancelReason = '';
    appointment.cancelledAt = null;
    appointment.checkedInAt = null;
    await saveLeavingQueue(appointment, wasQueued);
    await syncFollowUpParent(appointment, { linked: true });
    await queueIdexxCensus(appointment);
    emitAppointmentUpdate(appointment);
    res.json(appointment);
  } catch (err) {
    next(err);
  }
});

// 永久刪除只開放給已離開候診流程的掛號，避免誤刪尚待處理或已完成的看診資料。
router.delete('/:id', async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: '找不到掛號' });
    checkWorkflowCompatibility(appointment, req.path, req.body?.version);
    if (!['cancelled', 'no_show'].includes(appointment.status)) {
      return res.status(422).json({ message: '只有已取消或未到的掛號可以刪除' });
    }
    // 連著的報告草稿本來直接引用這筆看診的體重、體溫、檢驗數值；看診要消失了，先把值留在草稿上。
    const draft = appointment.recordId ? await MedicalRecord.exists({ _id: appointment.recordId, status: 'draft' }) : null;
    if (draft) {
      await withTransaction(async (session) => {
        const record = await MedicalRecord.findOne({ _id: appointment.recordId, status: 'draft' }).session(session);
        if (record) {
          const template = record.templateId ? await FormTemplate.findById(record.templateId).session(session) : null;
          await MedicalRecord.updateOne({ _id: record._id, status: 'draft' }, { $set: visitOverlay(record, appointment, template) }, { session });
        }
        await Appointment.deleteOne({ _id: appointment._id }).session(session);
      });
    } else {
      await appointment.deleteOne();
    }
    // 日誌與檢驗結果在取消那一刻就處理過了；這裡再確認一次，不留下指向已刪除掛號的資料。
    await ClinicalNote.deleteOne({ appointmentId: appointment._id });
    if (await releaseLabResults({ appointmentId: appointment._id })) emitLabResultsUpdate();
    await syncFollowUpParent(appointment, { linked: false });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
