import { Router } from 'express';
import mongoose from 'mongoose';
import MedicationOrder from '../models/MedicationOrder.js';
import Pet from '../models/Pet.js';
import Appointment from '../models/Appointment.js';
import { MEDICATION_ACTIVE, MEDICATION_STAGES } from '../../../shared/medicationWorkflow.js';
import { applyMedicationAction, medicationFields, recordMedicationEvent } from '../lib/medicationWorkflow.js';
import { emitMedicationUpdate } from '../lib/realtime.js';
import { escapeRegExp } from '../lib/regex.js';
import { paginatedPayload, paginationOptions } from '../lib/pagination.js';

const router = Router();
router.get('/', async (req, res, next) => {
  try {
    const status = req.query.status || 'active';
    if (!['active', 'all', ...MEDICATION_STAGES.map(stage => stage.key)].includes(status)) return res.status(422).json({ message: '藥單狀態不正確' });
    const filter = {};
    if (status === 'active') filter.status = { $in: MEDICATION_ACTIVE };
    else if (status !== 'all') filter.status = status;
    if (req.query.petId) {
      if (!mongoose.isValidObjectId(req.query.petId)) return res.status(422).json({ message: '寵物編號不正確' });
      filter.petId = req.query.petId;
    }
    if (req.query.q) {
      const q = new RegExp(escapeRegExp(String(req.query.q).slice(0, 200)), 'i');
      filter.$or = ['petName', 'ownerName', 'ownerPhone', 'medicalRecordNumber'].map(key => ({ [key]: q }));
    }
    const pagination = paginationOptions(req.query, { defaultLimit: 25, maxLimit: 100 });
    const [items, total, grouped] = await Promise.all([
      MedicationOrder.find(filter).select('-history').sort({ createdAt: status === 'active' || MEDICATION_ACTIVE.includes(status) ? 1 : -1, _id: 1 }).skip(pagination.skip).limit(pagination.limit),
      MedicationOrder.countDocuments(filter),
      MedicationOrder.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);
    res.json({ ...paginatedPayload(items, total, pagination), counts: Object.fromEntries(grouped.map(item => [item._id, item.count])) });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const order = await MedicationOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ message: '找不到藥單' });
    res.json(order);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const fields = medicationFields(req.body);
    if (!mongoose.isValidObjectId(req.body.petId)) return res.status(422).json({ message: '請選擇寵物' });
    const pet = await Pet.findById(req.body.petId).populate('ownerId');
    if (!pet?.ownerId) return res.status(404).json({ message: '找不到寵物或飼主資料' });
    let appointmentId = null;
    if (req.body.appointmentId) {
      const appointment = await Appointment.findById(req.body.appointmentId);
      if (!appointment || String(appointment.petId) !== String(pet._id)) return res.status(422).json({ message: '就診資料與寵物不符' });
      appointmentId = appointment._id;
    }
    const order = new MedicationOrder({ ...fields, petId: pet._id, ownerId: pet.ownerId._id, appointmentId,
      petName: pet.name, ownerName: pet.ownerId.name, ownerPhone: pet.ownerId.phone, medicalRecordNumber: pet.medicalRecordNumber || '' });
    recordMedicationEvent(order, 'create', req.user.username, '');
    await order.save();
    emitMedicationUpdate(order);
    res.status(201).json(order);
  } catch (err) { next(err); }
});

router.post('/:id/actions/:action', async (req, res, next) => {
  try {
    const order = await MedicationOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ message: '找不到藥單' });
    applyMedicationAction(order, req.params.action, req.body, req.user.username);
    await order.save();
    emitMedicationUpdate(order);
    res.json(order);
  } catch (err) { next(err); }
});
export default router;
