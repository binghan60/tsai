import { Router } from 'express';
import mongoose from 'mongoose';
import Appointment from '../models/Appointment.js';
import Pet from '../models/Pet.js';
import Owner from '../models/Owner.js';
import { withTransaction } from '../lib/transaction.js';
import { clinicDayStart } from '../lib/clinicTime.js';
import { escapeRegExp } from '../lib/regex.js';
import { APPOINTMENT_STATUSES, canTransitionAppointmentStatus, describeAppointmentTransition } from '../lib/appointmentStatus.js';

const router = Router();

const EDITABLE_FIELDS = ['date', 'time', 'reason', 'notes', 'petName', 'species', 'ownerPhone'];

function pickEditableFields(body) {
  return Object.fromEntries(EDITABLE_FIELDS.filter((field) => body[field] !== undefined).map((field) => [field, body[field]]));
}

function validateAppointmentInput({ date, ownerName }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '').trim())) return '請填寫預約日期';
  if (!String(ownerName || '').trim()) return '請填寫飼主姓名';
  return '';
}

// GET /api/appointments?q=&from=YYYY-MM-DD&to=YYYY-MM-DD&status=&page=
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 25, 1), 100);

    const scheduledAt = {};
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? clinicDayStart(req.query.from) : null;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? clinicDayStart(req.query.to, 1) : null;
    if (from) scheduledAt.$gte = from;
    if (to) scheduledAt.$lt = to;

    // 篩選條件不含狀態，讓 FilterTabs 上的數字反映「這個關鍵字／日期區間底下各狀態各有幾筆」。
    const baseFilter = Object.keys(scheduledAt).length ? { scheduledAt } : {};
    const keyword = String(req.query.q || '').trim();
    if (keyword) {
      const pattern = new RegExp(escapeRegExp(keyword), 'i');
      baseFilter.$or = [{ petName: pattern }, { ownerName: pattern }, { ownerPhone: pattern }, { reason: pattern }];
    }

    const status = String(req.query.status || '').trim();
    const listFilter = status && APPOINTMENT_STATUSES.includes(status) ? { ...baseFilter, status } : baseFilter;

    const [items, total, countBuckets] = await Promise.all([
      Appointment.find(listFilter)
        .sort({ scheduledAt: 1, createdAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Appointment.countDocuments(listFilter),
      Appointment.aggregate([{ $match: baseFilter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);

    const counts = Object.fromEntries(APPOINTMENT_STATUSES.map((key) => [key, 0]));
    countBuckets.forEach(({ _id, count }) => {
      if (_id in counts) counts[_id] = count;
    });
    counts.all = countBuckets.reduce((sum, bucket) => sum + bucket.count, 0);

    res.json({ items, total, page, limit, counts });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { date, time, petId, reason, notes } = req.body;
    let { ownerId, ownerName, ownerPhone, petName, species } = req.body;

    if (petId !== undefined && petId !== null && petId !== '') {
      if (!mongoose.isValidObjectId(petId)) return res.status(422).json({ message: '寵物編號格式不正確' });
      const pet = await Pet.findById(petId).populate('ownerId', 'name phone');
      if (!pet) return res.status(422).json({ message: '找不到指定的寵物' });
      // 不信任前端傳來的快照欄位，一律用資料庫當下的資料覆寫，避免快照與實際病患對不上。
      ownerId = pet.ownerId?._id ?? null;
      ownerName = pet.ownerId?.name ?? '';
      ownerPhone = pet.ownerId?.phone ?? '';
      petName = pet.name;
      species = pet.species;
    } else {
      ownerId = null;
    }

    const validationError = validateAppointmentInput({ date, ownerName });
    if (validationError) return res.status(422).json({ message: validationError });

    const appointment = await Appointment.create({
      date,
      time: time || '',
      ownerId,
      petId: petId || null,
      ownerName,
      ownerPhone: ownerPhone || '',
      petName: petName || '',
      species: species || '',
      reason: reason || '',
      notes: notes || '',
    });
    res.status(201).json(appointment);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: '找不到預約' });
    res.json(appointment);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const updates = pickEditableFields(req.body);
    if (updates.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(updates.date))) {
      return res.status(422).json({ message: '請填寫預約日期' });
    }
    const appointment = await Appointment.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true });
    if (!appointment) return res.status(404).json({ message: '找不到預約' });
    res.json(appointment);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status, cancelReason } = req.body;
    if (!APPOINTMENT_STATUSES.includes(status)) return res.status(422).json({ message: '狀態不正確' });

    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: '找不到預約' });
    if (!canTransitionAppointmentStatus(appointment.status, status)) {
      return res.status(422).json({ message: describeAppointmentTransition(appointment.status, status) });
    }

    appointment.status = status;
    appointment.cancelReason = status === 'cancelled' ? cancelReason || '' : '';
    await appointment.save();
    res.json(appointment);
  } catch (err) {
    next(err);
  }
});

// POST /api/appointments/:id/create-patient — 初診到診後補建 Owner+Pet，銜接進健檢報告填寫流程。
router.post('/:id/create-patient', async (req, res, next) => {
  try {
    const existing = await Appointment.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: '找不到預約' });
    if (existing.petId) {
      // 已經連結過既有病患或轉建過檔，回傳現況即可，讓重複點擊具備冪等性。
      return res.json({ ownerId: existing.ownerId, petId: existing.petId });
    }

    const petName = String(req.body?.petName || existing.petName || '').trim();
    if (!petName) return res.status(422).json({ message: '請填寫寵物名稱' });
    const species = String(req.body?.species || existing.species || '').trim();

    let ownerId;
    let petId;
    await withTransaction(async (session) => {
      const [owner] = await Owner.create([{ name: existing.ownerName, phone: existing.ownerPhone }], { session });
      const [pet] = await Pet.create(
        [{ name: petName, ownerId: owner._id, ...(species ? { species } : {}) }],
        { session }
      );
      ownerId = owner._id;
      petId = pet._id;

      const nextStatus = existing.status === 'scheduled' ? 'arrived' : existing.status;
      await Appointment.findByIdAndUpdate(
        existing._id,
        { $set: { ownerId, petId, petName: pet.name, species: pet.species, status: nextStatus } },
        { session }
      );
    });

    res.json({ ownerId, petId });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: '找不到預約' });
    if (appointment.status === 'completed') {
      return res.status(409).json({ message: '已完成的預約無法刪除' });
    }
    await Appointment.deleteOne({ _id: appointment._id });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
