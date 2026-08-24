import { Router } from 'express';
import DeliveryLog from '../models/DeliveryLog.js';
import MedicalRecord from '../models/MedicalRecord.js';
import { escapeRegExp } from '../lib/regex.js';
import { clinicDayStart } from '../lib/clinicTime.js';

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
    // createdAt 是真正的時刻，而使用者挑的是「診所的那一天」，所以邊界要用診所時區換算。
    // 直接 new Date(`${from}T00:00:00`) 吃的是伺服器本地時區（正式環境是 UTC），
    // 整段區間會偏移八小時。to 要含當天整天，取隔天的開頭當上界。
    const createdAt = {};
    const from = clinicDayStart(req.query.from);
    const to = clinicDayStart(req.query.to, 1);
    if (from) createdAt.$gte = from;
    if (to) createdAt.$lt = to;
    if (Object.keys(createdAt).length) filter.createdAt = createdAt;

    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);

    const [items, total] = await Promise.all([
      // Message-ID 是 SMTP 供應商用來追蹤信件的技術識別碼，並非人可讀的寄送備註。
      // 流水帳介面不需要它，保留在資料庫供系統除錯即可。
      DeliveryLog.find(filter).select('-messageId').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit),
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
