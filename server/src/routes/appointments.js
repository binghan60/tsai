import { Router } from 'express';
import mongoose from 'mongoose';
import Appointment from '../models/Appointment.js';
import Pet from '../models/Pet.js';
import Owner from '../models/Owner.js';
import { withTransaction } from '../lib/transaction.js';
import { clinicToday, combineClinicDateTime } from '../lib/clinicTime.js';
import { canTransitionAppointmentStatus, describeAppointmentTransition } from '../lib/appointmentStatus.js';

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

    if (!ownerName) return res.status(422).json({ message: '請填寫飼主姓名' });

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

// 編輯：scheduled、arrived 可改時段/來院原因/身分快照；checkinNumber 任何狀態都能改
// （前台調整看診順序用），照樣要做當天衝突檢查。
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
      if (updates.ownerName !== undefined && !String(updates.ownerName).trim()) {
        return res.status(422).json({ message: '請填寫飼主姓名' });
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

    if (req.body.checkinNumber !== undefined) {
      const checkinNumber = Number(req.body.checkinNumber);
      if (!Number.isInteger(checkinNumber) || checkinNumber < 1) {
        return res.status(422).json({ message: '看診序號須為正整數' });
      }
      const conflictExists = await Appointment.exists({
        date: appointment.date,
        checkinNumber,
        _id: { $ne: appointment._id },
      });
      if (conflictExists) return res.status(409).json({ message: '這個看診序號已被使用' });
      appointment.checkinNumber = checkinNumber;
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

    const hasRequestedNumber = req.body.checkinNumber !== undefined && String(req.body.checkinNumber).trim() !== '';
    let requestedNumber = null;
    if (hasRequestedNumber) {
      requestedNumber = Number(req.body.checkinNumber);
      if (!Number.isInteger(requestedNumber) || requestedNumber < 1) {
        return res.status(422).json({ message: '看診序號須為正整數' });
      }
    }

    await withTransaction(async (session) => {
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

      if (hasRequestedNumber) {
        const conflictExists = await Appointment.exists({
          date: appointment.date,
          checkinNumber: requestedNumber,
          _id: { $ne: appointment._id },
        }).session(session);
        if (conflictExists) {
          const error = new Error('這個看診序號已被使用');
          error.status = 409;
          throw error;
        }
        appointment.checkinNumber = requestedNumber;
      } else {
        const latest = await Appointment.findOne({ date: appointment.date, checkinNumber: { $ne: null } })
          .sort({ checkinNumber: -1 })
          .session(session);
        appointment.checkinNumber = (latest?.checkinNumber ?? 0) + 1;
      }

      appointment.status = 'arrived';
      appointment.checkedInAt = new Date();
      await appointment.save({ session });
    });

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
    appointment.status = 'completed';
    appointment.completedAt = new Date();
    await appointment.save();
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
    appointment.status = 'cancelled';
    appointment.cancelReason = String(req.body?.cancelReason || '').trim();
    appointment.checkinNumber = null;
    appointment.checkedInAt = null;
    await appointment.save();
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
    appointment.status = 'no_show';
    appointment.checkedInAt = null;
    await appointment.save();
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
    appointment.status = 'scheduled';
    appointment.cancelReason = '';
    appointment.checkinNumber = null;
    appointment.checkedInAt = null;
    await appointment.save();
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
