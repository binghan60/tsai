import { Router } from 'express';
import mongoose from 'mongoose';
import Pet from '../models/Pet.js';
import PinnedPet from '../models/PinnedPet.js';
import { STAFF_SENDERS, listPinnedPets, publishPinnedPets, upsertPinnedPets } from '../lib/pinnedPets.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    res.json({ items: await listPinnedPets() });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const pinnedBy = req.body?.pinnedBy;
    if (!STAFF_SENDERS.includes(pinnedBy)) return res.status(422).json({ message: '身分參數不正確' });
    const petId = String(req.body?.petId ?? '');
    if (!mongoose.isValidObjectId(petId)) return res.status(422).json({ message: '寵物參數不正確' });
    if (!(await Pet.exists({ _id: petId }))) return res.status(404).json({ message: '找不到寵物' });

    await upsertPinnedPets([petId], { pinnedBy, source: 'manual' });
    res.status(201).json({ items: await publishPinnedPets() });
  } catch (err) {
    next(err);
  }
});

router.delete('/:petId', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.petId)) return res.status(422).json({ message: '寵物參數不正確' });
    // 已經被另一台移除也算成功——使用者要的結果就是它不在暫存區裡。
    await PinnedPet.deleteOne({ petId: req.params.petId });
    res.json({ items: await publishPinnedPets() });
  } catch (err) {
    next(err);
  }
});

export default router;
