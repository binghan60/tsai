import { Router } from 'express';
import DeletedMedicalRecord from '../models/DeletedMedicalRecord.js';
import { escapeRegExp } from '../lib/regex.js';
import { clinicDayStart } from '../lib/clinicTime.js';
import { paginatedPayload, paginationOptions } from '../lib/pagination.js';

const router = Router();

// 已刪除報告的稽核查詢。
//
// 跟 deliveryLogs 一樣是「原始資料消失之後還要查得到」的紀錄，所以查詢也一樣
// 從快照本身出發，不去 populate 任何還活著的文件——被刪掉的那些正是最需要回溯的。
//
// 列表刻意不回傳 snapshot：那是整份報告的完整內容（含結案時凍結的 sections），
// 一頁 25 筆全帶會是好幾百 KB，而清單上根本用不到。要看內容再打 /:id。
const LIST_FIELDS = 'recordId reportNumber petId petName ownerName vet visitDate examType status deliveryStatus reportVersion deletedAt';

router.get('/', async (req, res, next) => {
  try {
    const filter = {};

    const keyword = String(req.query.q ?? '').trim();
    if (keyword) {
      const pattern = new RegExp(escapeRegExp(keyword), 'i');
      filter.$or = [{ reportNumber: pattern }, { petName: pattern }, { ownerName: pattern }, { vet: pattern }];
    }

    // deletedAt 是真正的時刻，而使用者挑的是「診所的那一天」，所以邊界要用診所時區換算。
    // 直接 new Date(`${from}T00:00:00`) 吃的是伺服器本地時區（正式環境是 UTC），
    // 整段區間會偏移八小時。to 要含當天整天，取隔天的開頭當上界。
    const from = String(req.query.from ?? '').trim();
    const to = String(req.query.to ?? '').trim();
    if (from || to) {
      filter.deletedAt = {};
      if (from) filter.deletedAt.$gte = clinicDayStart(from);
      if (to) filter.deletedAt.$lt = clinicDayStart(to, 1);
    }

    const pagination = paginationOptions(req.query, { defaultLimit: 10 });
    const [items, total] = await Promise.all([
      DeletedMedicalRecord.find(filter)
        .select(LIST_FIELDS)
        .sort({ deletedAt: -1, _id: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      DeletedMedicalRecord.countDocuments(filter),
    ]);

    res.json(paginatedPayload(items, total, pagination));
  } catch (err) {
    next(err);
  }
});

// 單筆的完整快照，給「當時到底寫了什麼」用。
router.get('/:id', async (req, res, next) => {
  try {
    const entry = await DeletedMedicalRecord.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: '找不到這筆刪除紀錄' });
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

export default router;
