import { Router } from 'express';
import ChatMessage from '../models/ChatMessage.js';
import { emitChatMessage } from '../lib/realtime.js';
import { mentionSnapshots, parseMentionIds } from '../lib/petMentions.js';
import { withTransaction } from '../lib/transaction.js';
import { MAX_MENTIONS, STAFF_SENDERS, publishPinnedPets, upsertPinnedPets } from '../lib/pinnedPets.js';

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
    if (!STAFF_SENDERS.includes(sender)) return res.status(422).json({ message: '身分參數不正確' });
    const content = String(req.body?.content ?? '').trim();
    if (!content) return res.status(422).json({ message: '訊息內容不可為空' });

    const auto = Boolean(req.body?.auto);
    let snapshot;
    if (req.body?.snapshot !== undefined) {
      const value = req.body.snapshot;
      if (!auto || !value || typeof value.before !== 'string' || typeof value.after !== 'string') {
        return res.status(422).json({ message: '異動快照格式不正確' });
      }
      snapshot = { before: value.before, after: value.after };
      if (value.fieldLabel !== undefined) {
        if (typeof value.fieldLabel !== 'string' || !value.fieldLabel.trim() || value.fieldLabel.length > 100) {
          return res.status(422).json({ message: '異動欄位名稱格式不正確' });
        }
        snapshot.fieldLabel = value.fieldLabel.trim();
      }
    }
    const uniqueMentionIds = parseMentionIds(req.body?.mentions);
    if (!uniqueMentionIds) {
      return res.status(422).json({ message: `標記的寵物格式不正確（一則訊息最多 ${MAX_MENTIONS} 隻）` });
    }
    const baseDoc = { sender, content, auto, ...(snapshot ? { snapshot } : {}) };

    if (!uniqueMentionIds.length) {
      const message = await ChatMessage.create(baseDoc);
      emitChatMessage(message);
      return res.status(201).json(message);
    }

    const mentions = await mentionSnapshots(uniqueMentionIds);
    if (!mentions) return res.status(422).json({ message: '標記的寵物不存在，可能已被刪除' });

    // 訊息與暫存區要嘛一起成功：訊息送出了暫存區卻沒放進去，對方就找不到那隻動物。
    let message;
    await withTransaction(async (session) => {
      [message] = await ChatMessage.create([{ ...baseDoc, mentions }], { session });
      await upsertPinnedPets(uniqueMentionIds, { pinnedBy: sender, source: 'mention', messageId: message._id, session });
    });
    emitChatMessage(message);
    await publishPinnedPets();
    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
});

export default router;
