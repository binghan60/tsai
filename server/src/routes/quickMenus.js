import { Router } from 'express';
import QuickMenu from '../models/QuickMenu.js';
import FormTemplate from '../models/FormTemplate.js';

const router = Router();
const text = (value, limit) => String(value ?? '').trim().slice(0, limit);
function payload(body) {
  return {
    name: text(body?.name, 80), enabled: body?.enabled !== false,
    items: Array.isArray(body?.items) ? body.items.map((item) => ({ label: text(item?.label, 80), content: text(item?.content, 1000), enabled: item?.enabled !== false })).filter((item) => item.label && item.content) : [],
  };
}
function validate(data) { return data.name ? '' : '請輸入快捷選單名稱'; }
router.get('/', async (req, res, next) => { try { const filter = req.query.includeDisabled === '1' ? {} : { enabled: true }; res.json(await QuickMenu.find(filter).sort({ name: 1 })); } catch (err) { next(err); } });
router.post('/', async (req, res, next) => { try { const data = payload(req.body); const message = validate(data); if (message) return res.status(422).json({ message }); res.status(201).json(await QuickMenu.create(data)); } catch (err) { next(err); } });
router.put('/:id', async (req, res, next) => {
  try {
    const data = payload(req.body); const message = validate(data);
    if (message) return res.status(422).json({ message });
    const expectedVersion = Number(req.body?.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) return res.status(428).json({ message: '缺少快捷選單版本資訊，請重新整理後再儲存' });
    const menu = await QuickMenu.findOneAndUpdate({ _id: req.params.id, __v: expectedVersion }, { $set: data, $inc: { __v: 1 } }, { new: true, runValidators: true });
    if (!menu) {
      if (!await QuickMenu.exists({ _id: req.params.id })) return res.status(404).json({ message: '找不到快捷選單' });
      return res.status(409).json({ message: '快捷選單已被其他人更新，請重新整理後再儲存' });
    }
    res.json(menu);
  } catch (err) { next(err); }
});
router.delete('/:id', async (req, res, next) => {
  try {
    const menu = await QuickMenu.findById(req.params.id);
    if (!menu) return res.status(404).json({ message: '找不到快捷選單' });
    const references = await FormTemplate.countDocuments({ 'sections.items.quickMenuId': String(menu._id) });
    if (references) return res.status(409).json({ message: `此快捷選單仍被 ${references} 個表單欄位使用，請先更換或移除引用` });
    await menu.deleteOne();
    res.status(204).end();
  } catch (err) { next(err); }
});
export default router;
