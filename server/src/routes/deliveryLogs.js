import { Router } from 'express';
import DeliveryLog from '../models/DeliveryLog.js';
import MedicalRecord from '../models/MedicalRecord.js';
import { escapeRegExp } from '../lib/regex.js';

const router = Router();

// 寄送流水帳的查詢介面。
//
// 這條路由存在的理由跟 DeliveryLog 本身一樣：報告可以被刪除，但「寄過什麼給誰」
// 必須留得下來。所以這裡刻意不從 MedicalRecord 出發去 populate 它的寄送紀錄——
// 那樣查得到的永遠只有還活著的報告，被刪掉的那些正好是最需要回溯的。
router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.recordId) filter.recordId = req.query.recordId;
    if (['queued', 'sent', 'failed', 'uncertain'].includes(req.query.event)) filter.event = req.query.event;
    const keyword = String(req.query.q ?? '').trim();
    if (keyword) {
      const pattern = new RegExp(escapeRegExp(keyword), 'i');
      filter.$or = [
        { recipient: pattern },
        { reportNumber: pattern },
        { petName: pattern },
        { ownerName: pattern },
      ];
    }
    const createdAt = {};
    const from = req.query.from ? new Date(`${req.query.from}T00:00:00`) : null;
    const to = req.query.to ? new Date(`${req.query.to}T00:00:00`) : null;
    if (from && !Number.isNaN(from.getTime())) createdAt.$gte = from;
    if (to && !Number.isNaN(to.getTime())) {
      to.setDate(to.getDate() + 1);
      createdAt.$lt = to;
    }
    if (Object.keys(createdAt).length) filter.createdAt = createdAt;

    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);

    const [items, total] = await Promise.all([
      DeliveryLog.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit),
      DeliveryLog.countDocuments(filter),
    ]);

    // 標記報告是否還在。前端要據此決定能不能提供「開啟報告」的連結——
    // 指向已刪除報告的連結只會走進 404，不如直接標成已刪除。
    const recordIds = [...new Set(items.map((item) => String(item.recordId)))];
    const alive = recordIds.length
      ? new Set(
          (await MedicalRecord.find({ _id: { $in: recordIds } }).select('_id')).map((doc) => String(doc._id))
        )
      : new Set();

    res.json({
      items: items.map((item) => ({ ...item.toObject(), recordExists: alive.has(String(item.recordId)) })),
      total,
      page,
      limit,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
