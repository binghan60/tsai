import { Router } from 'express';
import QuickMenu from '../models/QuickMenu.js';

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
router.put('/:id', async (req, res, next) => { try { const data = payload(req.body); const message = validate(data); if (message) return res.status(422).json({ message }); const menu = await QuickMenu.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true }); if (!menu) return res.status(404).json({ message: '找不到快捷選單' }); res.json(menu); } catch (err) { next(err); } });
router.delete('/:id', async (req, res, next) => { try { if (!await QuickMenu.findByIdAndDelete(req.params.id)) return res.status(404).json({ message: '找不到快捷選單' }); res.status(204).end(); } catch (err) { next(err); } });
export default router;
