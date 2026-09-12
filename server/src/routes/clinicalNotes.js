import { Router } from 'express';
import mongoose from 'mongoose';
import Appointment from '../models/Appointment.js';
import ClinicalNote from '../models/ClinicalNote.js';
import { clinicalNoteViews } from '../lib/clinicalNoteView.js';
import { paginatedPayload, paginationOptions } from '../lib/pagination.js';
import { withTransaction } from '../lib/transaction.js';
import { emitAppointmentUpdate, emitClinicalNoteUpdate } from '../lib/realtime.js';

const NOTE_FIELDS = ['content', 'entryDate'];

function pickNoteFields(body) {
  return Object.fromEntries(NOTE_FIELDS.filter((field) => body[field] !== undefined).map((field) => [field, body[field]]));
}

// 掛載於 /api/pets/:petId/clinical-notes
export const petClinicalNotesRouter = Router({ mergeParams: true });

petClinicalNotesRouter.get('/', async (req, res, next) => {
  try {
    const pagination = paginationOptions(req.query, { defaultLimit: 10, maxLimit: 50 });
    const filter = { petId: req.params.petId };
    if (req.query.excludeAppointmentId !== undefined) {
      if (!mongoose.isValidObjectId(req.query.excludeAppointmentId)) return res.status(422).json({ message: '掛號編號格式不正確' });
      filter.appointmentId = { $ne: req.query.excludeAppointmentId };
    }
    const [items, total] = await Promise.all([
      ClinicalNote.find(filter).sort({ entryDate: -1, _id: -1 }).skip(pagination.skip).limit(pagination.limit),
      ClinicalNote.countDocuments(filter),
    ]);
    res.json(paginatedPayload(await clinicalNoteViews(items), total, pagination));
  } catch (err) {
    next(err);
  }
});

petClinicalNotesRouter.post('/', async (req, res, next) => {
  try {
    const note = await ClinicalNote.create({ ...pickNoteFields(req.body), petId: req.params.petId });
    res.status(201).json(note);
  } catch (err) {
    next(err);
  }
});

// 掛載於 /api/clinical-notes
export const clinicalNotesRouter = Router();

clinicalNotesRouter.put('/:id', async (req, res, next) => {
  try {
    const fields = pickNoteFields(req.body);
    let note;
    let appointment;
    await withTransaction(async session => {
      const existing = await ClinicalNote.findById(req.params.id).session(session);
      if (existing?.appointmentId) {
        appointment = await Appointment.findById(existing.appointmentId).session(session);
        if (!appointment) throw Object.assign(new Error('找不到對應的就診資料'), { status: 404 });
        if (fields.content !== undefined) appointment.visitNote = String(fields.content ?? '').trim();
        appointment.increment();
        await appointment.save({ session });
        const noteFields = {};
        if (fields.entryDate !== undefined) noteFields.entryDate = fields.entryDate;
        note = Object.keys(noteFields).length
          ? await ClinicalNote.findByIdAndUpdate(req.params.id, { $set: noteFields }, { new: true, runValidators: true, session })
          : existing;
      } else {
        note = await ClinicalNote.findByIdAndUpdate(req.params.id, { $set: fields }, { new: true, runValidators: true, session });
      }
    });
    if (!note) return res.status(404).json({ message: '找不到病歷日誌' });
    if (appointment) emitAppointmentUpdate(appointment);
    const [view] = await clinicalNoteViews([note]);
    emitClinicalNoteUpdate(view ?? note);
    res.json(view ?? note);
  } catch (err) {
    next(err);
  }
});

clinicalNotesRouter.delete('/:id', async (req, res, next) => {
  try {
    let deleted;
    await withTransaction(async session => {
      const existing = await ClinicalNote.findById(req.params.id).session(session);
      if (existing?.appointmentId) throw Object.assign(new Error('此日誌引用就診資料，不能單獨刪除'), { status: 409 });
      deleted = await ClinicalNote.findByIdAndDelete(req.params.id, { session });
    });
    if (!deleted) return res.status(404).json({ message: '找不到病歷日誌' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
