import { Router } from 'express';
import DeletedMedicalRecord from '../models/DeletedMedicalRecord.js';
import MedicalRecord from '../models/MedicalRecord.js';
import Pet from '../models/Pet.js';

const router = Router();

// 只列還沒還原過的——還原後這份紀錄已經回到 medicalRecords，
// 繼續留在回收桶清單裡只會讓人以為它還沒救回來。
router.get('/', async (req, res, next) => {
  try {
    const entries = await DeletedMedicalRecord.find({ restoredAt: null })
      .sort({ deletedAt: -1 })
      .populate({ path: 'petId', select: 'name species medicalRecordNumber ownerId', populate: { path: 'ownerId', select: 'name' } });
    res.json(entries);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/restore', async (req, res, next) => {
  try {
    const entry = await DeletedMedicalRecord.findById(req.params.id);
    if (!entry || entry.restoredAt) return res.status(404).json({ message: '找不到可還原的刪除紀錄' });

    const pet = await Pet.findById(entry.petId);
    if (!pet) return res.status(409).json({ message: '寵物資料已被刪除，無法還原這份報告' });

    // 快照就是刪除前那份文件的完整內容（含原本的 _id），原樣插回去，
    // 分享連結、報告編號、歷次修訂關聯才不會因為還原而跟著變。
    const { __v, ...snapshot } = entry.snapshot;
    const restored = await MedicalRecord.create(snapshot);

    entry.restoredAt = new Date();
    await entry.save();

    res.json({ id: restored._id });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: '還原失敗，報告編號已被其他紀錄使用' });
    }
    next(err);
  }
});

// 永久刪除：連稽核快照一起清掉，回收桶本身沒有再下一層了。
router.delete('/:id', async (req, res, next) => {
  try {
    const entry = await DeletedMedicalRecord.findByIdAndDelete(req.params.id);
    if (!entry) return res.status(404).json({ message: '找不到這筆刪除紀錄' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
