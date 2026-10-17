import { Router } from 'express';
import mongoose from 'mongoose';
import Appointment from '../models/Appointment.js';
import ClinicalNote from '../models/ClinicalNote.js';
import MedicationOrder from '../models/MedicationOrder.js';
import { applyJournalFields } from '../lib/appointmentWorkflow.js';
import { syncImageUploadTodo } from '../lib/imageUploadTodo.js';
import { publishTodos } from '../lib/todos.js';
import { STAFF_SENDERS } from '../lib/pinnedPets.js';
import { applyMedicationJournalEdit } from '../lib/medicationWorkflow.js';
import { syncMedicationJournal } from '../lib/medicationJournal.js';
import { syncOrderFromJournal } from '../lib/visitMedicationOrder.js';
import { writeBackEntryPrescription } from '../lib/entryMedicationOrder.js';
import { clinicalNoteViews } from '../lib/clinicalNoteView.js';
import { linkedLabResults } from '../lib/appointmentJournal.js';
import { paginatedPayload, paginationOptions } from '../lib/pagination.js';
import { withTransaction } from '../lib/transaction.js';
import { emitAppointmentUpdate, emitClinicalNoteUpdate, emitHospitalizationUpdate, emitMedicationUpdate } from '../lib/realtime.js';
import Pet from '../models/Pet.js';

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

// 手動新增一則記事（自由文字）。掛號與藥單的日誌由系統跟著來源自動維護，不從這裡建立。
petClinicalNotesRouter.post('/', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.petId) || !(await Pet.exists({ _id: req.params.petId }))) {
      return res.status(404).json({ message: '找不到貓咪' });
    }
    const fields = pickNoteFields(req.body);
    if (typeof fields.content !== 'string' || !fields.content.trim()) return res.status(422).json({ message: '請填寫日誌內容' });
    const note = await ClinicalNote.create({ ...fields, petId: req.params.petId });
    emitClinicalNoteUpdate({ petId: req.params.petId, _id: note._id });
    res.status(201).json(note);
  } catch (err) {
    next(err);
  }
});

// 掛載於 /api/clinical-notes
export const clinicalNotesRouter = Router();

// 掛號日誌與藥單日誌只存關聯，編輯是寫回來源文件：
//   - 掛號：body.fields 可帶來院原因、體重、體溫、本次簡易紀錄、請轉告飼主、回診建議（見 applyJournalFields），
//     另可帶 entryDate 改日誌日期。
//   - 藥單：body.fields 可帶病況、藥單、備註，寫回藥單並在 history 記 journal_edit（見 applyMedicationJournalEdit）。
//     藥單日誌的日期跟著藥單建立時間走，不接受 entryDate。
//   - 手動與舊系統匯入的記事是自由文字：改 content／entryDate。
clinicalNotesRouter.put('/:id', async (req, res, next) => {
  try {
    const fields = pickNoteFields(req.body);
    let note;
    let appointment;
    let order;
    let visitOrder;
    let stayEntry;
    let todosChanged = false;
    await withTransaction(async session => {
      todosChanged = false;
      stayEntry = null;
      const existing = await ClinicalNote.findById(req.params.id).session(session);
      if (existing?.medicationOrderId) {
        order = await MedicationOrder.findById(existing.medicationOrderId).session(session);
        if (!order) throw Object.assign(new Error('找不到對應的藥單資料'), { status: 404 });
        if (applyMedicationJournalEdit(order, req.body.fields ?? {}, req.user?.username || '')) {
          await order.save({ session });
          await syncMedicationJournal(order, { session });
          // 住院開藥開的藥單：日誌上更正的內容寫回那一格照護紀錄。
          stayEntry = await writeBackEntryPrescription(order, { session });
        } else {
          order = null;
        }
        note = existing;
        return;
      }
      if (existing?.appointmentId) {
        appointment = await Appointment.findById(existing.appointmentId).session(session);
        if (!appointment) throw Object.assign(new Error('找不到對應的就診資料'), { status: 404 });
        if (req.body.fields !== undefined) {
          const labResults = (await linkedLabResults([appointment._id], { session })).get(String(appointment._id)) ?? [];
          const previousPrescription = appointment.prescription;
          const imageUploadBefore = Boolean(appointment.imageUpload);
          applyJournalFields(appointment, req.body.fields, { labResults });
          // 日誌上勾起來或取消「上傳影像」：同一個 transaction 新增／收掉那筆院內待辦（跟櫃台處理視窗一樣）。
          if (Boolean(appointment.imageUpload) !== imageUploadBefore) {
            const createdBy = STAFF_SENDERS.includes(req.body.staff) ? req.body.staff : 'front_desk';
            todosChanged = await syncImageUploadTodo(appointment, createdBy, { session });
          }
          // 日誌上改了藥單：連著的藥單同一個 transaction 跟著改，兩邊不會各說各話。
          visitOrder = await syncOrderFromJournal(appointment, previousPrescription, req.user?.username || '', { session });
          appointment.increment();
          await appointment.save({ session });
        } else {
          // 沒有要改看診內容（只改日期）就不動掛號，免得白白讓開著的工作區版本過期。
          appointment = null;
        }
        const noteFields = {};
        if (fields.entryDate !== undefined) noteFields.entryDate = fields.entryDate;
        note = Object.keys(noteFields).length
          ? await ClinicalNote.findByIdAndUpdate(req.params.id, { $set: noteFields }, { new: true, runValidators: true, session })
          : existing;
      } else {
        if (fields.content !== undefined && (typeof fields.content !== 'string' || !fields.content.trim())) {
          throw Object.assign(new Error('日誌內容不能空白'), { status: 422 });
        }
        note = await ClinicalNote.findByIdAndUpdate(req.params.id, { $set: fields }, { new: true, runValidators: true, session });
      }
    });
    if (!note) return res.status(404).json({ message: '找不到病歷日誌' });
    if (appointment) emitAppointmentUpdate(appointment);
    if (todosChanged) await publishTodos();
    if (order) emitMedicationUpdate(order);
    if (stayEntry) emitHospitalizationUpdate({ _id: stayEntry.hospitalizationId, petId: stayEntry.petId });
    if (visitOrder) emitMedicationUpdate(visitOrder);
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
    emitClinicalNoteUpdate({ petId: deleted.petId, _id: deleted._id });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
