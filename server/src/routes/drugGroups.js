import { Router } from 'express';
import mongoose from 'mongoose';
import DrugGroup from '../models/DrugGroup.js';
import { cleanDrugName, DRUG_NAME_MAX_LENGTH, drugNameKey } from '../lib/drugs.js';
import { deleteDrugGroup, moveDrugGroup } from '../lib/drugCabinet.js';
import { emitDrugsUpdate } from '../lib/realtime.js';
import { sortByDrugOrder } from '../../../shared/drugOrder.js';

// 藥櫃分類。分類與藥品共用 drugs:updated，前端一起重讀。
const router = Router();

const isObjectId = (value) => mongoose.isValidObjectId(value) && String(value).length === 24;
const isDuplicateKeyError = (err) => err?.code === 11000;

function checkName(body) {
  const name = cleanDrugName(body?.name);
  if (!name) return { message: '請填寫分類名稱' };
  if (name.length > DRUG_NAME_MAX_LENGTH) return { message: `請控制在 ${DRUG_NAME_MAX_LENGTH} 字以內` };
  return { name };
}

router.get('/', async (req, res, next) => {
  try {
    const groups = await DrugGroup.find().select('-nameKey').lean();
    res.json(sortByDrugOrder(groups));
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, message } = checkName(req.body);
    if (message) return res.status(422).json({ message });
    let group;
    try {
      group = await DrugGroup.create({ name, nameKey: drugNameKey(name) });
    } catch (err) {
      if (isDuplicateKeyError(err)) return res.status(409).json({ message: `已經有「${name}」這個分類` });
      throw err;
    }
    emitDrugsUpdate();
    const plain = group.toObject();
    delete plain.nameKey;
    res.status(201).json(plain);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { name, message } = checkName(req.body);
    if (message) return res.status(422).json({ message });
    const expectedVersion = Number(req.body?.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return res.status(428).json({ message: '缺少版本資訊，請重新整理後再試' });
    }
    let group;
    try {
      group = await DrugGroup.findOneAndUpdate(
        { _id: req.params.id, __v: expectedVersion },
        { $set: { name, nameKey: drugNameKey(name) }, $inc: { __v: 1 } },
        { new: true, runValidators: true }
      ).select('-nameKey');
    } catch (err) {
      if (isDuplicateKeyError(err)) return res.status(409).json({ message: `已經有「${name}」這個分類` });
      throw err;
    }
    if (!group) {
      const current = await DrugGroup.findById(req.params.id).select('_id').lean();
      if (!current) return res.status(404).json({ message: '找不到這個分類' });
      return res.status(409).json({ message: '這個分類剛被其他裝置修改，請重新整理後再試' });
    }
    emitDrugsUpdate();
    res.json(group);
  } catch (err) {
    next(err);
  }
});

// 分類之間排序：{ beforeId }，null＝移到最後。
router.post('/:id/move', async (req, res, next) => {
  try {
    const beforeId = req.body?.beforeId ?? null;
    if (!isObjectId(req.params.id) || (beforeId !== null && !isObjectId(beforeId))) {
      return res.status(422).json({ message: '資料格式不正確' });
    }
    const result = await moveDrugGroup(req.params.id, beforeId);
    if (result === 'missing') return res.status(404).json({ message: '找不到這個分類' });
    if (result === 'stale') return res.status(409).json({ message: '順序剛被其他裝置改過，請重新整理後再試' });
    emitDrugsUpdate();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// 刪除分類：組內藥品移到未分類。
router.delete('/:id', async (req, res, next) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ message: '找不到這個分類' });
    const deleted = await deleteDrugGroup(req.params.id);
    if (!deleted) return res.status(404).json({ message: '找不到這個分類' });
    emitDrugsUpdate();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
