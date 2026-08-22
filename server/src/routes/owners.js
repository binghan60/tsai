import { Router } from 'express';
import Owner from '../models/Owner.js';
import Pet from '../models/Pet.js';
import { withTransaction } from '../lib/transaction.js';

const router = Router();

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validateOwnerInput({ name, phone, email }) {
  if (!String(name || '').trim()) return '請填寫飼主姓名';
  if (!String(phone || '').trim()) return '請填寫聯絡電話';
  if (String(email || '').trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) return 'Email 格式不正確';
  return '';
}

// GET /api/owners?q=關鍵字
router.get('/', async (req, res, next) => {
  try {
    const { q } = req.query;
    const keyword = q ? new RegExp(escapeRegExp(String(q)), 'i') : null;
    const filter = keyword
      ? { $or: [{ name: keyword }, { phone: keyword }] }
      : {};
    const owners = await Owner.find(filter).sort({ createdAt: -1 });
    res.json(owners);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, phone, email } = req.body;
    const validationError = validateOwnerInput({ name, phone, email });
    if (validationError) return res.status(422).json({ message: validationError });
    const owner = await Owner.create({ name, phone, email });
    res.status(201).json(owner);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const owner = await Owner.findById(req.params.id);
    if (!owner) return res.status(404).json({ message: '找不到飼主' });
    const pets = await Pet.find({ ownerId: owner._id });
    res.json({ ...owner.toObject(), pets });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { name, phone, email } = req.body;
    const validationError = validateOwnerInput({ name, phone, email });
    if (validationError) return res.status(422).json({ message: validationError });
    const owner = await Owner.findByIdAndUpdate(
      req.params.id,
      { name, phone, email },
      { new: true, runValidators: true }
    );
    if (!owner) return res.status(404).json({ message: '找不到飼主' });
    res.json(owner);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await withTransaction(async (session) => {
      const owner = await Owner.findById(req.params.id).session(session);
      if (!owner) {
        const error = new Error('找不到飼主');
        error.status = 404;
        throw error;
      }
      if (await Pet.exists({ ownerId: owner._id }).session(session)) {
        const error = new Error('此飼主底下仍有寵物，請先刪除或轉移寵物');
        error.status = 409;
        throw error;
      }
      const deleted = await Owner.deleteOne({ _id: owner._id }, { session });
      if (deleted.deletedCount !== 1) {
        const error = new Error('飼主資料正在被其他操作更新，請重新整理後再試');
        error.status = 409;
        throw error;
      }
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
