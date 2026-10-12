import { Router } from 'express';
import mongoose from 'mongoose';
import ChatMessage from '../models/ChatMessage.js';
import { emitChatMessage } from '../lib/realtime.js';
import { mentionSnapshots, parseMentionIds } from '../lib/petMentions.js';
import { withTransaction } from '../lib/transaction.js';
import { MAX_MENTIONS, STAFF_SENDERS, publishPinnedPets, upsertPinnedPets } from '../lib/pinnedPets.js';

const router = Router();
// 跟 models/ChatMessage.js 的 maxlength 一致；在這裡先擋，使用者才看得到講人話的訊息。
const MAX_CONTENT_LENGTH = 1000;

// 全站只有一個對話：每次回傳一頁（預設 30 則）、依時間正序排列，hasMore＝更早還有。
// 自動通知一天就有上百則，以前一登入就整包載入 100 則（很多帶修改前後的快照），每台裝置、每次重新整理都一樣。
// 往前翻用游標：before＝目前最舊那則的 _id。ObjectId 由伺服器建立、跟著時間遞增，直接走 _id 索引，不必 skip。
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
router.get('/messages', async (req, res, next) => {
  try {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
    const filter = {};
    if (req.query.before !== undefined) {
      if (!mongoose.isValidObjectId(req.query.before)) return res.status(422).json({ message: '游標格式不正確' });
      filter._id = { $lt: new mongoose.Types.ObjectId(String(req.query.before)) };
    }
    // 多拿一則，判斷更早還有沒有。
    const items = await ChatMessage.find(filter).sort({ _id: -1 }).limit(limit + 1);
    res.json({ items: items.slice(0, limit).reverse(), hasMore: items.length > limit });
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
    if (content.length > MAX_CONTENT_LENGTH) return res.status(422).json({ message: `訊息最多 ${MAX_CONTENT_LENGTH} 字` });

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
      return res.status(422).json({ message: `標記的貓咪格式不正確（一則訊息最多 ${MAX_MENTIONS} 隻）` });
    }
    const baseDoc = { sender, content, auto, ...(snapshot ? { snapshot } : {}) };

    if (!uniqueMentionIds.length) {
      const message = await ChatMessage.create(baseDoc);
      emitChatMessage(message);
      return res.status(201).json(message);
    }

    const mentions = await mentionSnapshots(uniqueMentionIds);
    if (!mentions) return res.status(422).json({ message: '標記的貓咪不存在，可能已被刪除' });

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
