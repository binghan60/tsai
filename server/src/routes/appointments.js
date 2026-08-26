import { Router } from 'express';
import mongoose from 'mongoose';
import Appointment from '../models/Appointment.js';
import Pet from '../models/Pet.js';
import Owner from '../models/Owner.js';
import { withTransaction } from '../lib/transaction.js';
import { clinicToday, combineClinicDateTime } from '../lib/clinicTime.js';
import { canTransitionAppointmentStatus, describeAppointmentTransition } from '../lib/appointmentStatus.js';
import { positionUpdates, queueOrder } from '../lib/appointmentQueue.js';

const router = Router();

const EDITABLE_APPOINTMENT_FIELDS = ['date', 'time', 'reason', 'petName', 'ownerName', 'ownerPhone', 'species'];
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

// 讀出當日候診佇列。離開佇列的人（完成／取消／未到）號碼是 null，不在這裡面。
function waitingQueue(date, session) {
  return Appointment.find({ date, status: 'arrived' }).session(session);
}

// 把算好的順序寫回資料庫，回傳「這次真的換了號碼」的對照表。
async function applyQueueOrder(session, ordered) {
  const updates = positionUpdates(ordered);
  if (!updates.length) return new Map();
  // 唯一索引是一筆一筆檢查的，直接把 B 寫成 1 會撞到還沒讓位的 A。
  // 先整批挪到負數（跟正數不可能相撞，彼此之間也仍然互異），再寫回正式號碼。
  for (const sign of [-1, 1]) {
    await Appointment.bulkWrite(
      updates.map(({ _id, checkinNumber }) => ({
        updateOne: { filter: { _id }, update: { $set: { checkinNumber: sign * checkinNumber } } },
      })),
      { session }
    );
  }
  return new Map(updates.map(({ _id, checkinNumber }) => [String(_id), checkinNumber]));
}

// 讓一筆掛號離開佇列並存檔：先清掉自己的號碼，再讓後面的人遞補。
// 順序不能反過來——後面的人往前補位時會撞到自己還佔著的那個號碼。
// 沒排進佇列過的（還沒報到就取消）不會動到別人，直接存就好。
async function saveLeavingQueue(appointment, wasQueued) {
  appointment.checkinNumber = null;
  if (!wasQueued) {
    await appointment.save();
    return;
  }
  await withTransaction(async (session) => {
    await appointment.save({ session });
    await applyQueueOrder(session, queueOrder(await waitingQueue(appointment.date, session)));
  });
}

// 兩個人同時報到會各自算出同一個隊尾號碼，被唯一索引擋下。那不是使用者做錯什麼，
// 重算一次就會拿到正確的下一個位置，所以在這裡自行重試，不要把錯誤丟到前台。
async function withQueueRetry(operation, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      if (err?.code !== 11000 || attempt >= attempts) throw err;
    }
  }
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

    // 目前只做單日時間軸，不開放選日期，一律掛在今天。
    const date = clinicToday();
    const scheduledAt = time ? combineClinicDateTime(date, time) : new Date();

    const appointment = await Appointment.create({
      date,
      time: time || '',
      scheduledAt,
      ownerId,
      petId: petId || null,
      ownerName,
      ownerPhone,
      petName,
      species,
      reason: reason || '',
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
// 看診順序不在這裡也不對外開放——它是佇列位置，由報到與離隊自動維護。
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
    if (needsNewPatient) {
      if (!String(req.body.ownerName || '').trim()) return res.status(422).json({ message: '請填寫飼主姓名' });
      if (!String(req.body.ownerPhone || '').trim()) return res.status(422).json({ message: '請填寫聯絡電話' });
      if (!String(req.body.petName || '').trim()) return res.status(422).json({ message: '請填寫寵物姓名' });
    }

    await withQueueRetry(() => withTransaction(async (session) => {
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

      // 報到＝接到隊尾。號碼是佇列位置，由佇列決定，呼叫端指定不了。
      const waiting = await waitingQueue(appointment.date, session).where({ _id: { $ne: appointment._id } });
      const ordered = [...queueOrder(waiting), appointment];
      const positions = await applyQueueOrder(session, ordered);

      appointment.status = 'arrived';
      appointment.checkedInAt = new Date();
      appointment.checkinNumber = positions.get(String(appointment._id)) ?? ordered.length;
      await appointment.save({ session });
    }));

    res.json(appointment);
  } catch (err) {
    next(err);
  }
});

// arrived → completed。只更新這筆掛號本身，不建立也不觸碰任何 MedicalRecord——
// 健檢報告的表單類型只能在建立當下選一次，這裡先自己保管量測值，
// 之後從 /pets/:petId/records/new?fromAppointment= 轉過去。
router.post('/:id/complete', async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: '找不到掛號' });
    if (!canTransitionAppointmentStatus(appointment.status, 'completed')) {
      return res.status(422).json({ message: describeAppointmentTransition(appointment.status, 'completed') });
    }
    const { weightKg, temperatureC, visitNote } = req.body;
    if (weightKg !== undefined) appointment.weightKg = weightKg === '' || weightKg == null ? null : Number(weightKg);
    if (temperatureC !== undefined) {
      appointment.temperatureC = temperatureC === '' || temperatureC == null ? null : Number(temperatureC);
    }
    if (visitNote !== undefined) appointment.visitNote = visitNote;
    const wasQueued = appointment.status === 'arrived';
    appointment.status = 'completed';
    appointment.completedAt = new Date();
    // 看完診就離開佇列，後面的人往前遞補——序號講的是「現在排第幾個」。
    await saveLeavingQueue(appointment, wasQueued);
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
