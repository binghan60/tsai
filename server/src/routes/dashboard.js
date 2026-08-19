import { Router } from 'express';
import Owner from '../models/Owner.js';
import Pet from '../models/Pet.js';
import MedicalRecord from '../models/MedicalRecord.js';

const router = Router();

const WEEKS = 6;

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
        MedicalRecord.countDocuments({ createdAt: { $gte: startOfMonth } }),
        MedicalRecord.countDocuments({ status: 'draft' }),
        MedicalRecord.aggregate([
          { $group: { _id: { status: '$status', deliveryStatus: '$deliveryStatus' }, count: { $sum: 1 } } },
        ]),
        MedicalRecord.find({ createdAt: { $gte: trendStart } }, 'createdAt'),
        MedicalRecord.find()
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

    const statusBreakdown = { draft: 0, finalized: 0, sending: 0, sent: 0, failed: 0 };
    statusCounts.forEach(({ _id, count }) => {
      if (_id.status === 'draft') {
        statusBreakdown.draft += count;
        return;
      }
      const deliveryStatus = _id.deliveryStatus || 'not_sent';
      if (deliveryStatus === 'sent') statusBreakdown.sent += count;
      else if (deliveryStatus === 'failed') statusBreakdown.failed += count;
      else if (deliveryStatus === 'sending') statusBreakdown.sending += count;
      else statusBreakdown.finalized += count;
    });

    res.json({
      ownerCount,
      petCount,
      monthlyReportCount,
      draftCount,
      finalizedPendingCount: statusBreakdown.finalized + statusBreakdown.sending,
      failedCount: statusBreakdown.failed,
      statusBreakdown,
      weeklyTrend,
      recentRecords,
      draftRecords: await MedicalRecord.find({ status: 'draft' })
        .sort({ updatedAt: -1 })
        .limit(5)
        .populate({ path: 'petId', select: 'name species medicalRecordNumber ownerId', populate: { path: 'ownerId', select: 'name phone' } }),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
