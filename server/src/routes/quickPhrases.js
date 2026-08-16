import { Router } from 'express';
import QuickPhrase from '../models/QuickPhrase.js';

const router = Router();

const readItemKey = (value) => String(value ?? '').trim();

// 全部一次給前端，讓它自己依欄位分組 —— 這份資料量很小（單人診所頂多數百句），
// 每個欄位各打一次 API 反而是浪費。
router.get('/', async (req, res, next) => {
  try {
    const phrases = await QuickPhrase.find().sort({ usageCount: -1, updatedAt: -1 });
    res.json(phrases);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const text = String(req.body?.text ?? '').trim();
    if (!text) return res.status(422).json({ message: '請先在欄位裡輸入內容再存成常用語' });
    if (text.length > 500) return res.status(422).json({ message: '常用語請控制在 500 字以內' });
    const itemKey = readItemKey(req.body?.itemKey);
    if (!itemKey) return res.status(422).json({ message: '常用語必須指定所屬欄位' });

    // 存過同一句就把原本那筆還回去。這裡回 409 的話，使用者只會看到一個
    // 「已經存在」的錯誤，卻不知道那句話其實已經在清單裡可以直接用了。
    const existing = await QuickPhrase.findOne({ itemKey, text });
    if (existing) return res.json(existing);

    // 起算 1 次而不是 0：這句話是使用者剛打完才存起來的，本來就已經用過一次。
    // 從 0 起算的話，新存的常用語會排在所有用過的後面，一存好就看不到了。
    const phrase = await QuickPhrase.create({ text, itemKey, usageCount: 1 });
    res.status(201).json(phrase);
  } catch (err) {
    // 同一句話同時存兩次會撞唯一索引，這不是錯誤，把既有那筆回給前端即可。
    if (err?.code === 11000) {
      const phrase = await QuickPhrase.findOne({
        itemKey: readItemKey(req.body?.itemKey),
        text: String(req.body?.text ?? '').trim(),
      });
      if (phrase) return res.json(phrase);
    }
    next(err);
  }
});

// 用過一次就加一。前端是射後不理地呼叫，失敗了也只是排序沒更新，不影響填表。
router.post('/:id/use', async (req, res, next) => {
  try {
    const phrase = await QuickPhrase.findByIdAndUpdate(
      req.params.id,
      { $inc: { usageCount: 1 } },
      { new: true }
    );
    if (!phrase) return res.status(404).json({ message: '找不到這句常用語' });
    res.json(phrase);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const phrase = await QuickPhrase.findByIdAndDelete(req.params.id);
    if (!phrase) return res.status(404).json({ message: '找不到這句常用語' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
