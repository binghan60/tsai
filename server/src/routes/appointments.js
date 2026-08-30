import { Router } from 'express';
import mongoose from 'mongoose';
import Appointment from '../models/Appointment.js';
import Pet from '../models/Pet.js';
import Owner from '../models/Owner.js';
import FormTemplate from '../models/FormTemplate.js';
import MedicalRecord from '../models/MedicalRecord.js';
import ClinicSettings from '../models/ClinicSettings.js';
import { withTransaction } from '../lib/transaction.js';
import { clinicToday, combineClinicDateTime } from '../lib/clinicTime.js';
import { canTransitionAppointmentStatus, describeAppointmentTransition } from '../lib/appointmentStatus.js';
import { nextAvailableCheckinNumber } from '../lib/appointmentQueue.js';

const router = Router();

const EDITABLE_APPOINTMENT_FIELDS = ['date', 'time', 'reason', 'petName', 'ownerName', 'ownerPhone', 'species', 'templateId'];
const EDITABLE_APPOINTMENT_STATUSES = new Set(['scheduled', 'arrived']);
const APPOINTMENT_TIME_RANGES = [
  ['10:00', '11:30'],
  ['14:00', '19:30'],
];
const APPOINTMENT_TIME_ERROR = '預約時段僅限 10:00–11:30、14:00–19:30，且每 5 分鐘一格';

function minutesOfTime(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function isValidAppointmentTime(value) {
  if (!value) return true;
  const minutes = minutesOfTime(value);
  if (minutes == null || minutes % 5 !== 0) return false;
  return APPOINTMENT_TIME_RANGES.some(([start, end]) => {
    const startMinutes = minutesOfTime(start);
    const endMinutes = minutesOfTime(end);
    return minutes >= startMinutes && minutes <= endMinutes;
  });
}

async function resolveAppointmentTemplate(templateId) {
  const selectedId = templateId || (await ClinicSettings.findOne().lean())?.defaultAppointmentTemplateId;
  if (!selectedId) {
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

// 實體號碼牌只屬於持牌者；離開候診時歸還這張牌，不改動任何其他人的牌號。
// 歸還前先寫入 history，確保同一天不會再次配發這個已叫過的號碼。
async function saveLeavingQueue(appointment, wasQueued, session = null) {
  if (wasQueued) rememberCheckinNumber(appointment, appointment.checkinNumber);
  if (wasQueued || appointment.checkinNumber != null) appointment.checkinNumber = null;
  await appointment.save(session ? { session } : undefined);
}

// 兩個人同時報到可能各自算出同一張今日未發牌號，被唯一索引擋下。那不是使用者做錯什麼，
// 重算一次就會拿到另一張未發牌號，所以在這裡自行重試，不要把錯誤丟到前台。
async function withQueueRetry(operation, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      if (err?.code !== 11000 || attempt >= attempts) throw err;
    }
  }
}

// 週檢視用的日期範圍內每日掛號計數。純邏輯函式讓 test 不用真的連資料庫。
export function enumerateDates(start, end) {
  const dates = [];
  let current = new Date(Date.UTC(
    Number(start.slice(0, 4)),
    Number(start.slice(5, 7)) - 1,
    Number(start.slice(8, 10))
  ));
  const endDate = new Date(Date.UTC(
    Number(end.slice(0, 4)),
    Number(end.slice(5, 7)) - 1,
    Number(end.slice(8, 10))
  ));
  while (current <= endDate) {
    const iso = current.toISOString().slice(0, 10);
    dates.push(iso);
    current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
}

export function fillDailyCounts(dates, buckets) {
  const counts = new Map(buckets.map((bucket) => [bucket._id, bucket.count]));
  return dates.map((date) => ({ date, count: counts.get(date) ?? 0 }));
}

// GET /api/appointments?date=YYYY-MM-DD（預設今天）
// 目前畫面只做單日時間軸，量不大，直接回傳當天全部，不分頁。
router.get('/', async (req, res, next) => {
  try {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : clinicToday();
    const items = await Appointment.find({ date }).sort({ scheduledAt: 1, createdAt: 1 });
    res.json({ items, date });
  } catch (err) {
    next(err);
  }
});

// GET /api/appointments/summary?start=YYYY-MM-DD&end=YYYY-MM-DD
// 週檢視用的日期範圍內每日掛號計數。
router.get('/summary', async (req, res, next) => {
  try {
    const start = String(req.query.start || '').trim();
    const end = String(req.query.end || '').trim();
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    if (!dateRegex.test(start) || !dateRegex.test(end)) {
      return res.status(422).json({ message: '請提供有效的開始日期與結束日期（YYYY-MM-DD 格式）' });
    }

    if (start > end) {
      return res.status(422).json({ message: '開始日期不可晚於結束日期' });
    }

    // 防呆：限制最多 31 天
    const startDate = new Date(start);
    const endDate = new Date(end);
    const daysDiff = Math.floor((endDate - startDate) / (24 * 60 * 60 * 1000));
    if (daysDiff > 30) {
      return res.status(422).json({ message: '查詢範圍最多 31 天' });
    }

    const buckets = await Appointment.aggregate([
      { $match: { date: { $gte: start, $lte: end } } },
      { $group: { _id: '$date', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);

    const dates = enumerateDates(start, end);
    const items = fillDailyCounts(dates, buckets);
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
      if (!mongoose.isValidObjectId(petId)) return res.status(422).json({ message: '寵物編號格式不正確' });
      const pet = await Pet.findById(petId).populate('ownerId', 'name phone');
      if (!pet) return res.status(422).json({ message: '找不到指定的寵物' });
      ownerId = pet.ownerId?._id ?? null;
      ownerName = pet.ownerId?.name ?? '';
      ownerPhone = pet.ownerId?.phone ?? '';
      petName = pet.name;
      species = pet.species;
    } else {
      // 初診：身分尚未確定，先存文字快照，報到時才正式建檔。
      ownerName = String(req.body.ownerName || '').trim();
      ownerPhone = String(req.body.ownerPhone || '').trim();
      petName = String(req.body.petName || '').trim();
      species = String(req.body.species || '').trim();
    }

    // 飼主姓名選填（電話掛號時常常只問得到寵物名），但一筆掛號至少要指得出是誰要來。
    // 回診的 petName 抄自 Pet.name、必定有值，所以這一條實際上只會擋到初診。
    if (!petName) return res.status(422).json({ message: '請填寫寵物姓名' });

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

    const template = await resolveAppointmentTemplate(req.body.templateId);
    const appointment = await Appointment.create({
      date,
      time: time || '',
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
      templateId: template._id,
    });
    res.status(201).json(appointment);
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

// 編輯：scheduled、arrived 可改時段／來院原因／身分快照。
// 看診順序由下方專用路由調整，避免一般資料編輯意外改動整條候診佇列。
router.put('/:id', async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: '找不到掛號' });

    if (EDITABLE_APPOINTMENT_STATUSES.has(appointment.status)) {
      const updates = {};
      for (const field of EDITABLE_APPOINTMENT_FIELDS) {
        if (req.body[field] !== undefined) updates[field] = req.body[field];
      }
      if (updates.time !== undefined) {
        updates.time = String(updates.time || '').trim();
        if (!isValidAppointmentTime(updates.time)) return res.status(422).json({ message: APPOINTMENT_TIME_ERROR });
      }
      if (updates.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(updates.date))) {
        return res.status(422).json({ message: '請填寫預約日期' });
      }
      if (updates.petName !== undefined && !String(updates.petName).trim()) {
        return res.status(422).json({ message: '請填寫寵物姓名' });
      }
      if (updates.templateId !== undefined) {
        const template = await resolveAppointmentTemplate(updates.templateId);
        updates.templateId = template._id;
      }
      Object.assign(appointment, updates);
      const nextTime = updates.time ?? appointment.time;
      if (updates.time !== undefined || updates.date !== undefined) {
        appointment.scheduledAt = nextTime
          ? combineClinicDateTime(appointment.date, nextTime)
          : appointment.date === clinicToday()
            ? new Date()
            : combineClinicDateTime(appointment.date, '');
      }
    }

    await appointment.save();
    res.json(appointment);
  } catch (err) {
    next(err);
  }
});

// 手動修改現場發出的實體號碼牌。牌號不是候診順位，不會改動其他病患；
// 但同一時間不能把同一張紙本牌發給兩位仍在候診的人。
router.patch('/:id/check-in-number', async (req, res, next) => {
  try {
    const requestedNumber = Number(req.body?.checkinNumber);
    if (!Number.isSafeInteger(requestedNumber) || requestedNumber < 1) {
      return res.status(422).json({ message: '號碼牌必須是從 1 開始的整數' });
    }

    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: '找不到掛號' });
    if (appointment.status !== 'arrived') {
      return res.status(422).json({ message: '只有已報到的掛號可以修改號碼牌' });
    }
    if (requestedNumber === appointment.checkinNumber) return res.json(appointment);

    await withTransaction(async (session) => {
      const issuedAppointments = await appointmentsWithIssuedNumbers(appointment.date, session);
      const duplicate = issuedAppointments.some((item) =>
        item.checkinNumber === requestedNumber || (item.checkinNumberHistory ?? []).includes(requestedNumber)
      );
      if (duplicate) {
        const error = new Error(`${requestedNumber} 號牌今天已經使用過`);
        error.status = 409;
        throw error;
      }
      rememberCheckinNumber(appointment, appointment.checkinNumber);
      rememberCheckinNumber(appointment, requestedNumber);
      appointment.checkinNumber = requestedNumber;
      await appointment.save({ session });
    });

    res.json(appointment);
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ message: '這個號碼牌今天已經使用過' });
    next(err);
  }
});

// scheduled → arrived。初診（petId 尚未確定）body 需帶 ownerName/ownerPhone/petName/species
// 才能建立正式 Owner/Pet；回診（petId 已確定）body 可為空。
router.post('/:id/check-in', async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: '找不到掛號' });
    if (!canTransitionAppointmentStatus(appointment.status, 'arrived')) {
      return res.status(422).json({ message: describeAppointmentTransition(appointment.status, 'arrived') });
    }

    const needsNewPatient = !appointment.petId;
    // 舊掛號沒有 visitType；趁 petId 還沒因初診建檔而改變前補記，之後取消報到或
    // 再次報到都仍保有掛號當下的類型。新掛號本來就有值，不會被這裡覆寫。
    if (!appointment.visitType) appointment.visitType = needsNewPatient ? 'new' : 'return';
    if (needsNewPatient) {
      if (!String(req.body.ownerName || '').trim()) return res.status(422).json({ message: '請填寫飼主姓名' });
      if (!String(req.body.ownerPhone || '').trim()) return res.status(422).json({ message: '請填寫聯絡電話' });
      if (!String(req.body.petName || '').trim()) return res.status(422).json({ message: '請填寫寵物姓名' });
    }

    const originalNumberHistory = Array.from(appointment.checkinNumberHistory ?? []);
    await withQueueRetry(() => withTransaction(async (session) => {
      // transaction 因併發牌號衝突重試時，不能把失敗那次尚未發出的候選號留進 history。
      appointment.checkinNumberHistory = [...originalNumberHistory];
      if (needsNewPatient) {
        const species = String(req.body.species || '').trim();
        const [owner] = await Owner.create(
          [{ name: String(req.body.ownerName).trim(), phone: String(req.body.ownerPhone).trim() }],
          { session }
        );
        const [pet] = await Pet.create(
          [{ name: String(req.body.petName).trim(), ownerId: owner._id, ...(species ? { species } : {}) }],
          { session }
        );
        appointment.ownerId = owner._id;
        appointment.petId = pet._id;
        appointment.ownerName = owner.name;
        appointment.ownerPhone = owner.phone;
        appointment.petName = pet.name;
        appointment.species = pet.species;
      }

      // 報到時配一張今天從未發出過的實體號碼牌。候診先後仍由 checkedInAt 決定，
      // 所以這個數字之後即使人工修改，也不會改變誰先看診。
      const issuedAppointments = await appointmentsWithIssuedNumbers(appointment.date, session);

      appointment.status = 'arrived';
      appointment.checkedInAt = new Date();
      appointment.checkinNumber = nextAvailableCheckinNumber(issuedAppointments);
      rememberCheckinNumber(appointment, appointment.checkinNumber);
      await appointment.save({ session });
    }));

    res.json(appointment);
  } catch (err) {
    next(err);
  }
});

// arrived → completed。完成時立刻用掛號選定的表單建立草稿，讓看診人員不必再選一次。
router.post('/:id/complete', async (req, res, next) => {
  try {
    const initialAppointment = await Appointment.findById(req.params.id);
    if (!initialAppointment) return res.status(404).json({ message: '找不到掛號' });
    if (!canTransitionAppointmentStatus(initialAppointment.status, 'completed')) {
      return res.status(422).json({ message: describeAppointmentTransition(initialAppointment.status, 'completed') });
    }

    const { weightKg, temperatureC, visitNote } = req.body;
    let appointment;
    let record;

    // The record and the completed appointment must commit together. A concurrent
    // completion attempt loses optimistic concurrency and its transaction rolls back.
    await withTransaction(async (session) => {
      appointment = await Appointment.findById(req.params.id).session(session);
      if (!appointment) {
        const error = new Error('找不到掛號');
        error.status = 404;
        throw error;
      }
      if (!canTransitionAppointmentStatus(appointment.status, 'completed')) {
        const error = new Error(describeAppointmentTransition(appointment.status, 'completed'));
        error.status = 422;
        throw error;
      }

      const template = await resolveAppointmentTemplate(req.body.templateId || appointment.templateId);
      if (weightKg !== undefined) appointment.weightKg = weightKg === '' || weightKg == null ? null : Number(weightKg);
      if (temperatureC !== undefined) {
        appointment.temperatureC = temperatureC === '' || temperatureC == null ? null : Number(temperatureC);
      }
      if (visitNote !== undefined) appointment.visitNote = visitNote;
      appointment.status = 'completed';
      appointment.completedAt = new Date();
      appointment.templateId = template._id;
      [record] = await MedicalRecord.create([{
        petId: appointment.petId,
        visitDate: combineClinicDateTime(appointment.date, '10:00'),
        weightKg: appointment.weightKg,
        temperatureC: appointment.temperatureC,
        chiefComplaint: appointment.reason,
        other: appointment.visitNote,
        templateId: template._id,
        templateVersion: template.version,
        examType: template.name,
      }], { session });
      appointment.recordId = record._id;
      // 看完診就歸還自己的實體號碼牌；其他候診者手上的牌號完全不變。
      await saveLeavingQueue(appointment, true, session);
    });
    res.json({ ...(appointment.toObject?.() ?? appointment), record });
  } catch (err) {
    next(err);
  }
});

// 已完成後仍可修正候診時記下的量測與內部備註；若剛建立的草稿還沒結案，
// 同步更新草稿，避免掛號列表和接著打開的就診紀錄出現兩套資料。
router.patch('/:id/visit-data', async (req, res, next) => {
  try {
    const weightKg = req.body?.weightKg;
    const temperatureC = req.body?.temperatureC;
    const visitNote = req.body?.visitNote;
    let appointment;

    await withTransaction(async (session) => {
      appointment = await Appointment.findById(req.params.id).session(session);
      if (!appointment) {
        const error = new Error('找不到掛號');
        error.status = 404;
        throw error;
      }
      if (appointment.status !== 'completed') {
        const error = new Error('只有已完成的掛號可以編輯看診資料');
        error.status = 422;
        throw error;
      }

      if (weightKg !== undefined) appointment.weightKg = weightKg === '' || weightKg == null ? null : Number(weightKg);
      if (temperatureC !== undefined) appointment.temperatureC = temperatureC === '' || temperatureC == null ? null : Number(temperatureC);
      if (visitNote !== undefined) appointment.visitNote = String(visitNote ?? '').trim();

      if (appointment.recordId) {
        const record = await MedicalRecord.findById(appointment.recordId).session(session);
        if (record?.status === 'draft') {
          record.weightKg = appointment.weightKg;
          record.temperatureC = appointment.temperatureC;
          record.other = appointment.visitNote;
          await record.save({ session });
        }
      }

      await appointment.save({ session });
    });
    res.json(appointment);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/cancel', async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: '找不到掛號' });
    if (!canTransitionAppointmentStatus(appointment.status, 'cancelled')) {
      return res.status(422).json({ message: describeAppointmentTransition(appointment.status, 'cancelled') });
    }
    const wasQueued = appointment.status === 'arrived';
    appointment.status = 'cancelled';
    appointment.cancelReason = String(req.body?.cancelReason || '').trim();
    appointment.checkedInAt = null;
    await saveLeavingQueue(appointment, wasQueued);
    res.json(appointment);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/no-show', async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: '找不到掛號' });
    if (!canTransitionAppointmentStatus(appointment.status, 'no_show')) {
      return res.status(422).json({ message: describeAppointmentTransition(appointment.status, 'no_show') });
    }
    const wasQueued = appointment.status === 'arrived';
    appointment.status = 'no_show';
    appointment.checkedInAt = null;
    await saveLeavingQueue(appointment, wasQueued);
    res.json(appointment);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/restore', async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: '找不到掛號' });
    if (!canTransitionAppointmentStatus(appointment.status, 'scheduled')) {
      return res.status(422).json({ message: describeAppointmentTransition(appointment.status, 'scheduled') });
    }
    const wasQueued = appointment.status === 'arrived';
    appointment.status = 'scheduled';
    appointment.cancelReason = '';
    appointment.checkedInAt = null;
    await saveLeavingQueue(appointment, wasQueued);
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
    if (!['cancelled', 'no_show'].includes(appointment.status)) {
      return res.status(422).json({ message: '只有已取消或未到的掛號可以刪除' });
    }
    await appointment.deleteOne();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
