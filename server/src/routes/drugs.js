import { Router } from 'express';
import Drug from '../models/Drug.js';
import { cleanDrugName, DRUG_BULK_MAX, DRUG_NAME_MAX_LENGTH, drugNameKey, parseDrugNames } from '../lib/drugs.js';
import { emitDrugsUpdate } from '../lib/realtime.js';

// 藥櫃。清單整份給前端（量不大），比對與排序在前端做，打字時不必每個字打一次 API。
// 新增、修改、刪除後廣播 drugs:updated，其他裝置的建議清單跟著重讀；使用次數只影響排序，不廣播。
const router = Router();

const isDuplicateKeyError = (err) => err?.code === 11000;

router.get('/', async (req, res, next) => {
  try {
    const includeDisabled = req.query.includeDisabled === '1' || req.query.includeDisabled === 'true';
    const drugs = await Drug.find(includeDisabled ? {} : { enabled: true })
      .select('-nameKey')
      .sort({ usageCount: -1, name: 1 })
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
    const tooLong = names.find((name) => name.length > DRUG_NAME_MAX_LENGTH);
    if (tooLong) return res.status(422).json({ message: `每筆請控制在 ${DRUG_NAME_MAX_LENGTH} 字以內：${tooLong.slice(0, 20)}…` });

    const keys = names.map(drugNameKey);
    const existing = new Set((await Drug.find({ nameKey: { $in: keys } }).select('nameKey').lean()).map((drug) => drug.nameKey));
    const fresh = names.filter((name) => !existing.has(drugNameKey(name)));
    const skipped = names.filter((name) => existing.has(drugNameKey(name)));
    let created = [];
    if (fresh.length) {
      try {
        created = await Drug.insertMany(fresh.map((name) => ({ name, nameKey: drugNameKey(name) })), { ordered: false });
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
    if (name.length > DRUG_NAME_MAX_LENGTH) return res.status(422).json({ message: `請控制在 ${DRUG_NAME_MAX_LENGTH} 字以內` });
    const expectedVersion = Number(req.body?.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return res.status(428).json({ message: '缺少版本資訊，請重新整理後再試' });
    }
    const nameKey = drugNameKey(name);
    const clash = await Drug.findOne({ nameKey, _id: { $ne: req.params.id } }).select('_id').lean();
    if (clash) return res.status(409).json({ message: `藥櫃裡已經有「${name}」` });
    const fields = { name, nameKey, enabled: req.body?.enabled !== false };
    // 常用：沒帶 pinned 就不動。設成常用的時間決定輸入框上方按鈕的順序，已經是常用的再存一次不改時間。
    if (req.body?.pinned === false) fields.pinnedAt = null;
    if (req.body?.pinned === true) {
      const current = await Drug.findById(req.params.id).select('pinnedAt').lean();
      fields.pinnedAt = current?.pinnedAt ?? new Date();
    }
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

// 記一次使用：body.source 是 'pinned'（點常用按鈕）記在 pinnedUsageCount，其他（從建議清單選）記在 usageCount。
router.post('/:id/use', async (req, res, next) => {
  try {
    const field = req.body?.source === 'pinned' ? 'pinnedUsageCount' : 'usageCount';
    const result = await Drug.updateOne({ _id: req.params.id }, { $inc: { [field]: 1 } });
    if (!result.matchedCount) return res.status(404).json({ message: '找不到這筆藥品' });
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
