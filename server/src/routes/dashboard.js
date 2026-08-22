import { Router } from 'express';
import Owner from '../models/Owner.js';
import Pet from '../models/Pet.js';
import MedicalRecord from '../models/MedicalRecord.js';

const router = Router();

const WEEKS = 6;

// 儀錶板的每一個數字都只算「同一次健檢的最新版」，跟 GET /api/records 的佇列同一套判準。
// 少了這層，一份改過三次的報告會在統計裡算三次，而點進去的清單只列一列——
// 卡片正是為了點進去而存在的，兩邊對不上會直接讓人懷疑哪一邊在騙人。
// 草稿不可能被取代（supersededBy 只會標在被修訂的已結案報告上），對它們是無害的贅詞，
// 但寧可統一寫上：規則只有一條時才不會有人在新增查詢時漏掉。
const CURRENT_VERSION = { supersededBy: null };

router.get('/', async (req, res, next) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const trendStart = new Date(now);
    trendStart.setDate(trendStart.getDate() - (WEEKS - 1) * 7 - 6);
    trendStart.setHours(0, 0, 0, 0);

    const [ownerCount, petCount, monthlyReportCount, draftCount, statusCounts, trendRecords, recentRecords] =
      await Promise.all([
        Owner.countDocuments(),
        Pet.countDocuments(),
        MedicalRecord.countDocuments({ ...CURRENT_VERSION, createdAt: { $gte: startOfMonth } }),
        MedicalRecord.countDocuments({ ...CURRENT_VERSION, status: 'draft' }),
        MedicalRecord.aggregate([
          { $match: CURRENT_VERSION },
          { $group: { _id: { status: '$status', deliveryStatus: '$deliveryStatus' }, count: { $sum: 1 } } },
        ]),
        MedicalRecord.find({ ...CURRENT_VERSION, createdAt: { $gte: trendStart } }, 'createdAt'),
        MedicalRecord.find(CURRENT_VERSION)
          .sort({ updatedAt: -1 })
          .limit(5)
          .populate({ path: 'petId', select: 'name species medicalRecordNumber ownerId', populate: { path: 'ownerId', select: 'name phone' } }),
      ]);

    // 依週分桶（近 6 週，含本週），資料量小直接在 JS 裡分桶，不用寫聚合管線
    const weeklyTrend = Array.from({ length: WEEKS }, (_, i) => {
      const weekStart = new Date(trendStart);
      weekStart.setDate(weekStart.getDate() + i * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const count = trendRecords.filter((r) => r.createdAt >= weekStart && r.createdAt < weekEnd).length;
      return { weekEnd, count };
    });

    const statusBreakdown = { draft: 0, finalized: 0, sending: 0, sent: 0, failed: 0, uncertain: 0 };
    statusCounts.forEach(({ _id, count }) => {
      if (_id.status === 'draft') {
        statusBreakdown.draft += count;
        return;
      }
      const deliveryStatus = _id.deliveryStatus || 'not_sent';
      if (deliveryStatus === 'sent') statusBreakdown.sent += count;
      else if (deliveryStatus === 'failed') statusBreakdown.failed += count;
      else if (deliveryStatus === 'uncertain') statusBreakdown.uncertain += count;
      else if (deliveryStatus === 'sending') statusBreakdown.sending += count;
      else statusBreakdown.finalized += count;
    });

    res.json({
      ownerCount,
      petCount,
      monthlyReportCount,
      draftCount,
      finalizedPendingCount: statusBreakdown.finalized + statusBreakdown.sending + statusBreakdown.uncertain,
      failedCount: statusBreakdown.failed + statusBreakdown.uncertain,
      statusBreakdown,
      weeklyTrend,
      recentRecords,
      draftRecords: await MedicalRecord.find({ ...CURRENT_VERSION, status: 'draft' })
        .sort({ updatedAt: -1 })
        .limit(5)
        .populate({ path: 'petId', select: 'name species medicalRecordNumber ownerId', populate: { path: 'ownerId', select: 'name phone' } }),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
