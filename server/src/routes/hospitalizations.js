import { Router } from 'express';
import mongoose from 'mongoose';
import Appointment from '../models/Appointment.js';
import Hospitalization from '../models/Hospitalization.js';
import HospitalizationEntry from '../models/HospitalizationEntry.js';
import MedicationOrder from '../models/MedicationOrder.js';
import Pet from '../models/Pet.js';
import { workflowState } from '../../../shared/appointmentWorkflow.js';
import { normalizeRichText, richTextLength, richTextToPlain } from '../../../shared/richText.js';
import { withTransaction } from '../lib/transaction.js';
import { clinicDayStart, clinicToday } from '../lib/clinicTime.js';
import { paginatedPayload, paginationOptions } from '../lib/pagination.js';
import { syncAppointmentJournal } from '../lib/appointmentJournal.js';
import { cancelVisitMedicationOrder, syncVisitMedicationOrder } from '../lib/visitMedicationOrder.js';
import { recordMedicationEvent } from '../lib/medicationWorkflow.js';
import { announceMedicationJournal, syncMedicationJournal } from '../lib/medicationJournal.js';
import { releaseLabResults } from '../lib/labResultApply.js';
import { cleanEntryFields, hospitalDayNumber, hospitalizationDates } from '../lib/hospitalization.js';
import { emitAppointmentUpdate, emitClinicalNoteUpdate, emitHospitalizationUpdate, emitLabResultsUpdate, emitMedicationUpdate } from '../lib/realtime.js';

// 住院：一律從看診收住院（看診到一半才決定很常見），入院那次看診就是入院評估；
// 照紙本那張表一格一格記照護紀錄（每一格可以有自己的體重、體溫）；出院時帶回家的藥直接開成待包藥的藥單。
// 規則與畫面見 CLAUDE.md 第三節 hospitalizations。
const router = Router();

const fail = (message, status = 422) => Object.assign(new Error(message), { status });
const hasText = (value) => Boolean(richTextToPlain(value).trim());
const STAFF = ['vet', 'front_desk'];
// 出院時寫的文字欄位與字數上限（出院、事後修改共用）。
const DISCHARGE_TEXT_FIELDS = { dischargeNote: 2000, dischargeSpecialCareNote: 500, dischargeFollowUpRecommendation: 500 };
const dischargeText = (value, max) => String(value ?? '').trim().slice(0, max);

function requireId(value, message) {
  if (!mongoose.isValidObjectId(value)) throw fail(message);
  return value;
}

function requireVersion(body) {
  const version = Number(body?.version);
  if (!Number.isInteger(version) || version < 0) throw fail('缺少資料版本，請重新整理後再試', 428);
  return version;
}

async function loadHospitalization(id, session = null) {
  const hospitalization = await Hospitalization.findById(requireId(id, '住院單參數不正確')).session(session);
  if (!hospitalization) throw fail('找不到住院紀錄', 404);
  return hospitalization;
}

function assertVersion(doc, version) {
  if ((doc.__v ?? 0) !== version) throw fail('住院資料已被其他裝置更新，請重新整理後再試', 409);
}

// 照護紀錄：住院期間的某一天（入院那天到出院那天；還在住院就到今天）。取消的住院不能再記。
function assertWritableDay(hospitalization, date) {
  if (hospitalization.status === 'cancelled') throw fail('這次住院已取消', 409);
  const dates = hospitalizationDates(hospitalization.admittedAt, hospitalization.dischargedAt ?? new Date());
  if (!dates.includes(date)) throw fail('日期不在住院期間');
}

function announce(hospitalization) {
  emitHospitalizationUpdate(hospitalization);
}

// GET /api/hospitalizations?status=admitted|discharged&petId=
// 住院中全部列出（依入院時間）；已出院依出院時間新到舊、分頁。帶 petId（貓咪頁的住院頁籤）就列那隻貓全部的（不含取消的）。
// 每列帶住院第幾天、今天的體重、最後一筆照護紀錄的時間；counts 是頁籤上的數字。
router.get('/', async (req, res, next) => {
  try {
    const petId = req.query.petId ? requireId(String(req.query.petId), '貓咪參數不正確') : null;
    const status = ['admitted', 'discharged'].includes(req.query.status) ? req.query.status : null;
    const filter = petId
      ? { petId, status: { $in: ['admitted', 'discharged'] } }
      : { status: status ?? 'admitted' };
    // 各自接得上索引：貓咪頁 {petId, admittedAt}、住院中 {status, admittedAt}、已出院 {status, dischargedAt, _id}。
    const sort = petId ? { admittedAt: -1, _id: -1 } : filter.status === 'admitted' ? { admittedAt: 1, _id: 1 } : { dischargedAt: -1, _id: -1 };
    const pagination = paginationOptions(req.query, { defaultLimit: 50 });
    const [items, total, admittedCount, dischargedCount] = await Promise.all([
      Hospitalization.find(filter).sort(sort).skip(pagination.skip).limit(pagination.limit)
        .populate({ path: 'petId', select: 'name isStray ownerId', populate: { path: 'ownerId', select: 'name' } })
        .lean(),
      Hospitalization.countDocuments(filter),
      Hospitalization.countDocuments({ status: 'admitted' }),
      Hospitalization.countDocuments({ status: 'discharged' }),
    ]);
    const ids = items.map((item) => item._id);
    const today = clinicToday();
    // 今天體重＝今天最後一格有量體重的那筆。
    const todayStart = clinicDayStart(today);
    const [todayWeights, lastEntries] = ids.length
      ? await Promise.all([
        HospitalizationEntry.find({ hospitalizationId: { $in: ids }, weightKg: { $ne: null }, recordedAt: { $gte: todayStart } }).sort({ recordedAt: 1 }).select('hospitalizationId weightKg').lean(),
        HospitalizationEntry.aggregate([
          { $match: { hospitalizationId: { $in: ids } } },
          { $group: { _id: '$hospitalizationId', lastEntryAt: { $max: '$recordedAt' } } },
        ]),
      ])
      : [[], []];
    const weightById = new Map(todayWeights.map((entry) => [String(entry.hospitalizationId), entry.weightKg]));
    const lastById = new Map(lastEntries.map((row) => [String(row._id), row.lastEntryAt]));
    const rows = items.map((item) => {
      const end = item.dischargedAt ?? new Date();
      return {
        ...item,
        pet: item.petId ? { _id: item.petId._id, name: item.petId.name, isStray: item.petId.isStray === true, ownerName: item.petId.ownerId?.name ?? '' } : null,
        petId: item.petId?._id ?? null,
        dayNumber: hospitalDayNumber(clinicToday(new Date(item.admittedAt)), clinicToday(new Date(end))),
        todayWeightKg: item.status === 'admitted' ? weightById.get(String(item._id)) ?? null : null,
        lastEntryAt: lastById.get(String(item._id)) ?? null,
      };
    });
    res.json({ ...paginatedPayload(rows, total, pagination), counts: { admitted: admittedCount, discharged: dischargedCount } });
  } catch (err) {
    next(err);
  }
});

// GET /api/hospitalizations/:id — 住院專區：住院單、貓咪與飼主、入院那次看診（入院評估，只讀）、
// 住院期間的每一天（dates）、全部照護紀錄（舊到新）。檢驗結果另外讀 /lab-results?hospitalizationId=。
router.get('/:id', async (req, res, next) => {
  try {
    const hospitalization = await Hospitalization.findById(requireId(req.params.id, '住院單參數不正確')).lean();
    if (!hospitalization) return res.status(404).json({ message: '找不到住院紀錄' });
    const [pet, appointment, entries] = await Promise.all([
      Pet.findById(hospitalization.petId).populate('ownerId', 'name phone kind').lean(),
      Appointment.findById(hospitalization.admittingAppointmentId).select('date time reason weightKg temperatureC visitNote checkedInAt visitStartedAt').lean(),
      HospitalizationEntry.find({ hospitalizationId: hospitalization._id }).sort({ recordedAt: 1, _id: 1 }).lean(),
    ]);
    res.json({
      ...hospitalization,
      pet,
      admittingAppointment: appointment,
      dates: hospitalization.status === 'cancelled' ? [] : hospitalizationDates(hospitalization.admittedAt, hospitalization.dischargedAt ?? new Date()),
      entries,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/hospitalizations — 收住院：{ appointmentId, version（看診的版本）, reason, staff }。
// 醫師開始看診之後、櫃台完成處理之前都能收（看診到一半才決定很常見）。同一個 transaction：
//   · 建住院單；
//   · 這次看診已經寫的藥單搬到住院第一筆照護紀錄的「用藥」（院內用藥記在住院紀錄，不開藥單），看診上的清空；
//     已經送交櫃台、開出去還沒領的那張藥單一併取消；
//   · 看診記下 hospitalizationId（之後不能取消看診，送交櫃台也不開藥單）。
router.post('/', async (req, res, next) => {
  try {
    const appointmentId = requireId(req.body?.appointmentId, '請選擇看診');
    const version = requireVersion(req.body);
    const staff = STAFF.includes(req.body?.staff) ? req.body.staff : '';
    let appointment;
    let hospitalization;
    let cancelledOrder;
    await withTransaction(async (session) => {
      cancelledOrder = null;
      appointment = await Appointment.findById(appointmentId).session(session);
      if (!appointment) throw fail('找不到看診', 404);
      if ((appointment.__v ?? 0) !== version) throw fail('看診資料已更新，請重新載入後再辦理住院', 409);
      const state = workflowState(appointment);
      if (state.completed) throw fail('櫃台已完成處理這次看診，不能再辦理住院', 409);
      if (!appointment.petId || !['arrived', 'pending_checkout'].includes(appointment.status) || !state.started) {
        throw fail('要先開始看診，才能辦理住院', 409);
      }
      if (appointment.hospitalizationId) throw fail('這次看診已經收住院了', 409);
      if (await Hospitalization.exists({ petId: appointment.petId, status: 'admitted' }).session(session)) {
        throw fail('這隻貓已經在住院中', 409);
      }
      const now = new Date();
      [hospitalization] = await Hospitalization.create([{
        petId: appointment.petId,
        admittingAppointmentId: appointment._id,
        admittedAt: now,
        reason: String(req.body?.reason ?? appointment.reason ?? '').trim().slice(0, 200),
      }], { session });
      const prescription = String(appointment.prescription ?? '').trim();
      if (hasText(prescription)) {
        await HospitalizationEntry.create([{
          hospitalizationId: hospitalization._id,
          petId: appointment.petId,
          recordedAt: now,
          medication: prescription,
          staff,
          fromVisit: true,
        }], { session });
        appointment.prescription = '';
      }
      cancelledOrder = await cancelVisitMedicationOrder(appointment, '收住院：院內用藥改記在住院紀錄', { session, now });
      appointment.hospitalizationId = hospitalization._id;
      appointment.increment();
      await appointment.save({ session });
      await syncAppointmentJournal(appointment, { session });
    });
    emitAppointmentUpdate(appointment);
    emitClinicalNoteUpdate({ petId: appointment.petId, appointmentId: appointment._id });
    if (cancelledOrder) emitMedicationUpdate(cancelledOrder);
    announce(hospitalization);
    res.status(201).json({ hospitalization, appointment });
  } catch (err) {
    next(err);
  }
});

// PUT /api/hospitalizations/:id — 改住院原因：{ version, reason }；已出院的另收出院備註、請轉告飼主、回診建議。
router.put('/:id', async (req, res, next) => {
  try {
    const version = requireVersion(req.body);
    const hospitalization = await loadHospitalization(req.params.id);
    if (hospitalization.status === 'cancelled') throw fail('這次住院已取消', 409);
    assertVersion(hospitalization, version);
    if (req.body?.reason !== undefined) hospitalization.reason = String(req.body.reason ?? '').trim().slice(0, 200);
    if (hospitalization.status === 'discharged') {
      for (const [field, max] of Object.entries(DISCHARGE_TEXT_FIELDS)) {
        if (req.body?.[field] !== undefined) hospitalization[field] = dischargeText(req.body[field], max);
      }
    }
    await hospitalization.save();
    announce(hospitalization);
    res.json(hospitalization);
  } catch (err) {
    next(err);
  }
});

// POST /api/hospitalizations/:id/cancel — 收錯了：只有還沒記任何照護紀錄時能取消；
// 有紀錄就該辦出院。收住院時從看診搬過來的那一格用藥搬回看診的藥單，看診回到可以取消看診、送交時開藥單的樣子。
// 連到這次住院的檢驗結果回到待確認清單。
router.post('/:id/cancel', async (req, res, next) => {
  try {
    const version = requireVersion(req.body);
    let hospitalization;
    let appointment;
    let released = 0;
    let medicationOrder = null;
    await withTransaction(async (session) => {
      appointment = null;
      medicationOrder = null;
      hospitalization = await loadHospitalization(req.params.id, session);
      if (hospitalization.status !== 'admitted') throw fail('只有住院中的能取消', 409);
      assertVersion(hospitalization, version);
      const entries = await HospitalizationEntry.find({ hospitalizationId: hospitalization._id }).session(session);
      const recorded = entries.some((entry) => !entry.fromVisit);
      if (recorded) throw fail('已經有住院紀錄，不能取消住院；要結束住院請辦出院', 409);
      appointment = await Appointment.findById(hospitalization.admittingAppointmentId).session(session);
      if (appointment && String(appointment.hospitalizationId) === String(hospitalization._id)) {
        const moved = entries.find((entry) => entry.fromVisit)?.medication ?? '';
        if (moved && !hasText(appointment.prescription)) appointment.prescription = moved;
        appointment.hospitalizationId = null;
        // 已經送交櫃台的看診：收住院時取消了那張待包藥，搬回來的藥單要重新開出去，不然沒人包藥。
        if (appointment.handoffAt) medicationOrder = await syncVisitMedicationOrder(appointment, req.user?.username || '', { session });
        appointment.increment();
        await appointment.save({ session });
        await syncAppointmentJournal(appointment, { session });
      }
      await HospitalizationEntry.deleteMany({ hospitalizationId: hospitalization._id }, { session });
      released = await releaseLabResults({ hospitalizationId: hospitalization._id }, { session });
      hospitalization.status = 'cancelled';
      await hospitalization.save({ session });
    });
    if (appointment) {
      emitAppointmentUpdate(appointment);
      emitClinicalNoteUpdate({ petId: appointment.petId, appointmentId: appointment._id });
    }
    if (released) emitLabResultsUpdate();
    if (medicationOrder) emitMedicationUpdate(medicationOrder);
    announce(hospitalization);
    res.json(hospitalization);
  } catch (err) {
    next(err);
  }
});

// POST /api/hospitalizations/:id/discharge — 出院：{ version, dischargeNote, dischargeSpecialCareNote（請轉告飼主）,
//   dischargeFollowUpRecommendation（回診建議）, dischargedAt（選填，預設現在）, medication（帶回家的藥）}。
// 帶回家的藥有寫就同一個 transaction 開一張藥單：醫師開的、直接是待包藥（跟診療台送交時開的一樣不必再審），
// 有自己的領藥日誌（出院帶了什麼藥，病歷日誌看得到）。
router.post('/:id/discharge', async (req, res, next) => {
  try {
    const version = requireVersion(req.body);
    const medication = normalizeRichText(String(req.body?.medication ?? '')).trim();
    if (richTextLength(medication) > 10000) throw fail('帶回家的藥內容太長');
    const actor = req.user?.username || '';
    let hospitalization;
    let order;
    await withTransaction(async (session) => {
      order = null;
      hospitalization = await loadHospitalization(req.params.id, session);
      if (hospitalization.status !== 'admitted') throw fail('這次住院不是住院中', 409);
      assertVersion(hospitalization, version);
      const now = new Date();
      const dischargedAt = req.body?.dischargedAt ? new Date(req.body.dischargedAt) : now;
      if (Number.isNaN(dischargedAt.getTime())) throw fail('出院時間格式不正確');
      if (dischargedAt < hospitalization.admittedAt) throw fail('出院時間不能早於入院時間');
      if (dischargedAt.getTime() > now.getTime() + 60 * 1000) throw fail('出院時間不能晚於現在');
      if (hasText(medication)) {
        const pet = await Pet.findById(hospitalization.petId).populate('ownerId', 'name phone').session(session);
        if (!pet) throw fail('找不到貓咪', 404);
        order = new MedicationOrder({
          petId: pet._id, ownerId: pet.ownerId?._id, hospitalizationId: hospitalization._id,
          petName: pet.name, ownerName: pet.ownerId?.name ?? '', ownerPhone: pet.ownerId?.phone ?? '',
          prescription: medication,
        });
        recordMedicationEvent(order, 'create', actor, '', '出院帶回家的藥', now);
        order.status = 'approved';
        order.approvedAt = now;
        order.approvedBy = actor;
        recordMedicationEvent(order, 'approve', actor, 'review', '', now);
        await order.save({ session });
        await syncMedicationJournal(order, { session });
        hospitalization.dischargeMedicationOrderId = order._id;
      }
      hospitalization.status = 'discharged';
      hospitalization.dischargedAt = dischargedAt;
      for (const [field, max] of Object.entries(DISCHARGE_TEXT_FIELDS)) hospitalization[field] = dischargeText(req.body?.[field], max);
      await hospitalization.save({ session });
    });
    if (order) {
      emitMedicationUpdate(order);
      announceMedicationJournal(order);
    }
    // 入院那次看診的日誌上「住院」那一列從「住院中」變成期間與天數。
    emitClinicalNoteUpdate({ petId: hospitalization.petId, appointmentId: hospitalization.admittingAppointmentId });
    announce(hospitalization);
    res.json({ hospitalization, medicationOrder: order });
  } catch (err) {
    next(err);
  }
});

// POST /api/hospitalizations/:id/entries — 新增一格照護紀錄（時間沒帶＝現在）。
router.post('/:id/entries', async (req, res, next) => {
  try {
    const hospitalization = await loadHospitalization(req.params.id);
    const fields = cleanEntryFields(req.body);
    fields.recordedAt ??= new Date();
    assertWritableDay(hospitalization, clinicToday(fields.recordedAt));
    const entry = await HospitalizationEntry.create({ ...fields, hospitalizationId: hospitalization._id, petId: hospitalization.petId });
    announce(hospitalization);
    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
});

// PUT /api/hospitalizations/:id/entries/:entryId — 改一格（自動存檔）：{ version, ...欄位 }。
// 住院中與出院後都能改（事後更正）；版本不符回 409 附最新內容，不默默蓋掉別台剛改的。
router.put('/:id/entries/:entryId', async (req, res, next) => {
  try {
    const version = requireVersion(req.body);
    const hospitalization = await loadHospitalization(req.params.id);
    const fields = cleanEntryFields(req.body);
    if (fields.recordedAt) assertWritableDay(hospitalization, clinicToday(fields.recordedAt));
    else if (hospitalization.status === 'cancelled') throw fail('這次住院已取消', 409);
    const entryId = requireId(req.params.entryId, '照護紀錄參數不正確');
    const entry = await HospitalizationEntry.findOneAndUpdate(
      { _id: entryId, hospitalizationId: hospitalization._id, __v: version },
      { $set: fields, $inc: { __v: 1 } },
      { new: true, runValidators: true },
    );
    if (!entry) {
      const current = await HospitalizationEntry.findOne({ _id: entryId, hospitalizationId: hospitalization._id }).lean();
      if (!current) return res.status(404).json({ message: '找不到這筆照護紀錄' });
      return res.status(409).json({ message: '這筆紀錄已被其他裝置修改，已載入最新內容', current });
    }
    announce(hospitalization);
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/hospitalizations/:id/entries/:entryId — 刪掉一格（畫面上先確認）。
router.delete('/:id/entries/:entryId', async (req, res, next) => {
  try {
    const hospitalization = await loadHospitalization(req.params.id);
    const entryId = requireId(req.params.entryId, '照護紀錄參數不正確');
    const removed = await HospitalizationEntry.deleteOne({ _id: entryId, hospitalizationId: hospitalization._id });
    if (!removed.deletedCount) return res.status(404).json({ message: '找不到這筆照護紀錄' });
    announce(hospitalization);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
