import { Router } from 'express';
import Owner from '../models/Owner.js';
import Pet from '../models/Pet.js';

const router = Router();

// GET /api/owners?q=關鍵字
router.get('/', async (req, res, next) => {
  try {
    const { q } = req.query;
    const filter = q
      ? { $or: [{ name: new RegExp(q, 'i') }, { phone: new RegExp(q, 'i') }] }
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
    const petCount = await Pet.countDocuments({ ownerId: req.params.id });
    if (petCount > 0) {
      return res.status(409).json({ message: '此飼主底下仍有寵物，請先刪除或轉移寵物' });
    }
    const owner = await Owner.findByIdAndDelete(req.params.id);
    if (!owner) return res.status(404).json({ message: '找不到飼主' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
