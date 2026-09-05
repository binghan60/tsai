import { Router } from 'express';
import ClinicalNote from '../models/ClinicalNote.js';
import { paginatedPayload, paginationOptions } from '../lib/pagination.js';

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
    res.json(paginatedPayload(items, total, pagination));
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

// 這筆日誌若是掛號留言串同步出來的（appointmentId 有值），內容是單向從留言串
// 組出來的抄本——留言串是多則、多作者、只增不減的資料，沒辦法回推「改的是哪一則」，
// 所以擋掉手動改內容，請使用者回掛號頁的留言串新增留言（見 routes/appointments.js
// 的 syncVisitMessagesToClinicalNote）。
clinicalNotesRouter.put('/:id', async (req, res, next) => {
  try {
    const fields = pickNoteFields(req.body);
    const existing = await ClinicalNote.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: '找不到病歷日誌' });
    if (existing.appointmentId && fields.content !== undefined) {
      return res.status(422).json({ message: '此日誌內容由掛號留言自動同步，請至掛號頁的留言串新增留言' });
    }
    const note = await ClinicalNote.findByIdAndUpdate(req.params.id, { $set: fields }, { new: true, runValidators: true });
    res.json(note);
  } catch (err) {
    next(err);
  }
});

clinicalNotesRouter.delete('/:id', async (req, res, next) => {
  try {
    // 只刪病歷卡片上的抄本；掛號的留言串不受影響，下一則新留言會重新落地一筆。
    const deleted = await ClinicalNote.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: '找不到病歷日誌' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
