import { Router } from 'express';
import mongoose from 'mongoose';
import Drug from '../models/Drug.js';
import DrugGroup from '../models/DrugGroup.js';
import { cleanDrugName, DRUG_BULK_MAX, DRUG_NAME_MAX_LENGTH, drugNameKey, drugNameLength, parseDrugNames } from '../lib/drugs.js';
import { moveDrug } from '../lib/drugCabinet.js';
import { emitDrugsUpdate } from '../lib/realtime.js';

// 藥櫃。清單整份給前端（量不大），比對與排序在前端做，打字時不必每個字打一次 API。
// 新增、修改、搬移、刪除後廣播 drugs:updated，其他裝置的建議清單與藥櫃視窗跟著重讀。
const router = Router();

const isObjectId = (value) => mongoose.isValidObjectId(value) && String(value).length === 24;

const isDuplicateKeyError = (err) => err?.code === 11000;

router.get('/', async (req, res, next) => {
  try {
    const includeDisabled = req.query.includeDisabled === '1' || req.query.includeDisabled === 'true';
    const drugs = await Drug.find(includeDisabled ? {} : { enabled: true })
      .select('-nameKey')
      .sort({ name: 1 })
      .lean();
    res.json(drugs);
  } catch (err) {
    next(err);
  }
});

// 新增一筆或批次：body.names（陣列或一行一筆的文字）。已經在藥櫃裡的略過，回 { created, skipped }。
router.post('/', async (req, res, next) => {
  try {
    const names = parseDrugNames(req.body?.names ?? req.body?.name ?? '');
    if (!names.length) return res.status(422).json({ message: '請填寫藥品' });
    if (names.length > DRUG_BULK_MAX) return res.status(422).json({ message: `一次最多新增 ${DRUG_BULK_MAX} 筆` });
    const tooLong = names.find((name) => drugNameLength(name) > DRUG_NAME_MAX_LENGTH);
    if (tooLong) return res.status(422).json({ message: `每筆請控制在 ${DRUG_NAME_MAX_LENGTH} 字以內：${tooLong.slice(0, 20)}…` });

    // 新增到哪個分類（沒帶＝未分類）。
    const groupId = req.body?.groupId ?? null;
    if (groupId !== null) {
      if (!isObjectId(groupId) || !(await DrugGroup.exists({ _id: groupId }))) {
        return res.status(422).json({ message: '找不到這個分類' });
      }
    }

    const keys = names.map(drugNameKey);
    const existing = new Set((await Drug.find({ nameKey: { $in: keys } }).select('nameKey').lean()).map((drug) => drug.nameKey));
    const fresh = names.filter((name) => !existing.has(drugNameKey(name)));
    const skipped = names.filter((name) => existing.has(drugNameKey(name)));
    let created = [];
    if (fresh.length) {
      try {
        created = await Drug.insertMany(fresh.map((name) => ({ name, nameKey: drugNameKey(name), groupId })), { ordered: false });
      } catch (err) {
        // 同時有人新增了同一筆：其他的照樣寫進去，撞到的算略過。
        if (!isDuplicateKeyError(err)) throw err;
        created = err.insertedDocs ?? [];
        const createdKeys = new Set(created.map((drug) => drug.nameKey));
        skipped.push(...fresh.filter((name) => !createdKeys.has(drugNameKey(name))));
      }
    }
    if (created.length) emitDrugsUpdate();
    res.status(created.length ? 201 : 200).json({
      created: created.map((drug) => {
        const plain = typeof drug.toObject === 'function' ? drug.toObject() : { ...drug };
        delete plain.nameKey;
        return plain;
      }),
      skipped,
    });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const name = cleanDrugName(req.body?.name);
    if (!name) return res.status(422).json({ message: '請填寫藥品' });
    if (drugNameLength(name) > DRUG_NAME_MAX_LENGTH) return res.status(422).json({ message: `請控制在 ${DRUG_NAME_MAX_LENGTH} 字以內` });
    const expectedVersion = Number(req.body?.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return res.status(428).json({ message: '缺少版本資訊，請重新整理後再試' });
    }
    const nameKey = drugNameKey(name);
    const clash = await Drug.findOne({ nameKey, _id: { $ne: req.params.id } }).select('_id').lean();
    if (clash) return res.status(409).json({ message: `藥櫃裡已經有「${name}」` });
    const fields = { name, nameKey, enabled: req.body?.enabled !== false };
    // 換分類要同時排順序，一律走 /:id/move，這裡不收 groupId。
    let drug;
    try {
      drug = await Drug.findOneAndUpdate(
        { _id: req.params.id, __v: expectedVersion },
        { $set: fields, $inc: { __v: 1 } },
        { new: true, runValidators: true }
      ).select('-nameKey');
    } catch (err) {
      if (isDuplicateKeyError(err)) return res.status(409).json({ message: `藥櫃裡已經有「${name}」` });
      throw err;
    }
    if (!drug) {
      const current = await Drug.findById(req.params.id).select('_id').lean();
      if (!current) return res.status(404).json({ message: '找不到這筆藥品' });
      return res.status(409).json({ message: '這筆藥品剛被其他裝置修改，請重新整理後再試' });
    }
    emitDrugsUpdate();
    res.json(drug);
  } catch (err) {
    next(err);
  }
});

// 搬到某個分類（groupId，null＝未分類）的 beforeId 前面（null＝最後）；同一分類內拖拉排序也走這支。
router.post('/:id/move', async (req, res, next) => {
  try {
    const groupId = req.body?.groupId ?? null;
    const beforeId = req.body?.beforeId ?? null;
    if (!isObjectId(req.params.id) || (groupId !== null && !isObjectId(groupId)) || (beforeId !== null && !isObjectId(beforeId))) {
      return res.status(422).json({ message: '資料格式不正確' });
    }
    const result = await moveDrug(req.params.id, { groupId, beforeId });
    if (result === 'missing') return res.status(404).json({ message: '找不到這筆藥品或分類' });
    if (result === 'stale') return res.status(409).json({ message: '順序剛被其他裝置改過，請重新整理後再試' });
    emitDrugsUpdate();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const drug = await Drug.findByIdAndDelete(req.params.id);
    if (!drug) return res.status(404).json({ message: '找不到這筆藥品' });
    emitDrugsUpdate();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
