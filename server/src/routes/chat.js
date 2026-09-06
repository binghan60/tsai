import { Router } from 'express';
import ChatMessage from '../models/ChatMessage.js';
import { emitChatMessage } from '../lib/realtime.js';

const router = Router();

// 全站只有一個對話，沒有分頁需求——回傳最近 N 則、依時間正序排列，
// 給聊天視窗開啟時一次載入歷史用。
router.get('/messages', async (req, res, next) => {
  try {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 200) : 100;
    const items = await ChatMessage.find().sort({ createdAt: -1 }).limit(limit);
    res.json({ items: items.reverse() });
  } catch (err) {
    next(err);
  }
});

router.post('/messages', async (req, res, next) => {
  try {
    const sender = req.body?.sender;
    if (!['vet', 'front_desk'].includes(sender)) return res.status(422).json({ message: '身分參數不正確' });
    const content = String(req.body?.content ?? '').trim();
    if (!content) return res.status(422).json({ message: '訊息內容不可為空' });

    const message = await ChatMessage.create({ sender, content, auto: Boolean(req.body?.auto) });
    emitChatMessage(message);
    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
});

export default router;
