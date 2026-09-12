import { Router } from 'express';
import ClinicalNote from '../models/ClinicalNote.js';
import { clinicalNoteViews } from '../lib/clinicalNoteView.js';
import { paginatedPayload, paginationOptions } from '../lib/pagination.js';
import { withTransaction } from '../lib/transaction.js';

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
    await withTransaction(async session => {
      const existing = await ClinicalNote.findById(req.params.id).session(session);
      if (existing?.appointmentId) throw Object.assign(new Error('此日誌引用就診資料，請至醫師診療台修改'), { status: 409 });
      note = await ClinicalNote.findByIdAndUpdate(req.params.id, { $set: fields }, { new: true, runValidators: true, session });
    });
    if (!note) return res.status(404).json({ message: '找不到病歷日誌' });
    res.json(note);
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
