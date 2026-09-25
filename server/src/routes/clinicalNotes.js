import { Router } from 'express';
import mongoose from 'mongoose';
import Appointment from '../models/Appointment.js';
import ClinicalNote from '../models/ClinicalNote.js';
import MedicationOrder from '../models/MedicationOrder.js';
import { applyJournalFields } from '../lib/appointmentWorkflow.js';
import { applyMedicationJournalEdit } from '../lib/medicationWorkflow.js';
import { syncMedicationJournal } from '../lib/medicationJournal.js';
import { clinicalNoteViews } from '../lib/clinicalNoteView.js';
import { paginatedPayload, paginationOptions } from '../lib/pagination.js';
import { withTransaction } from '../lib/transaction.js';
import { emitAppointmentUpdate, emitClinicalNoteUpdate, emitMedicationUpdate } from '../lib/realtime.js';
import { normalizeRichText } from '../../../shared/richText.js';

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

// 掛號日誌與藥單日誌只存關聯，編輯是寫回來源文件：
//   - 掛號：body.fields 可帶來院原因、體重、體溫、本次簡易紀錄、請轉告飼主、回診建議（見 applyJournalFields）；
//     只帶 content 的舊呼叫方式仍等同改 visitNote。
//   - 藥單：body.fields 可帶病況、藥單、備註，寫回藥單並在 history 記 journal_edit（見 applyMedicationJournalEdit）。
//     藥單日誌的日期跟著藥單建立時間走，不接受 entryDate。
clinicalNotesRouter.put('/:id', async (req, res, next) => {
  try {
    const fields = pickNoteFields(req.body);
    let note;
    let appointment;
    let order;
    await withTransaction(async session => {
      const existing = await ClinicalNote.findById(req.params.id).session(session);
      if (existing?.medicationOrderId) {
        order = await MedicationOrder.findById(existing.medicationOrderId).session(session);
        if (!order) throw Object.assign(new Error('找不到對應的藥單資料'), { status: 404 });
        if (applyMedicationJournalEdit(order, req.body.fields ?? {}, req.user?.username || '')) {
          await order.save({ session });
          await syncMedicationJournal(order, { session });
        } else {
          order = null;
        }
        note = existing;
        return;
      }
      if (existing?.appointmentId) {
        appointment = await Appointment.findById(existing.appointmentId).session(session);
        if (!appointment) throw Object.assign(new Error('找不到對應的就診資料'), { status: 404 });
        if (req.body.fields !== undefined) applyJournalFields(appointment, req.body.fields);
        else if (fields.content !== undefined) appointment.visitNote = normalizeRichText(String(fields.content ?? '')).trim();
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
    if (order) emitMedicationUpdate(order);
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
      if (existing?.medicationOrderId) throw Object.assign(new Error('此日誌引用藥單資料，不能單獨刪除；藥單取消時會一併移除'), { status: 409 });
      deleted = await ClinicalNote.findByIdAndDelete(req.params.id, { session });
    });
    if (!deleted) return res.status(404).json({ message: '找不到病歷日誌' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
