import { Router } from 'express';
import MedicalRecord from '../models/MedicalRecord.js';
import Appointment from '../models/Appointment.js';
import { clinicDayStart, clinicToday } from '../lib/clinicTime.js';

// 總覽：由粗到細三層——寄送失敗（有才出現）→ 今天的門診四格＋健檢報告四格 → 近 8 週健檢量＋院內待辦。
// 每一個數字都點得進對應的清單，口徑要跟那份清單對得起來（掛號台的 ?stage=、報告清單的 ?view=）。
const router = Router();
const WEEKS = 8;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CURRENT_VERSION = { supersededBy: null };

export function buildWeekBoundaries(trendStart, weeks = WEEKS) {
  const startMs = new Date(trendStart).getTime();
  return Array.from({ length: weeks + 1 }, (_, index) => new Date(startMs + index * WEEK_MS));
}

export function fillWeeklyTrend(boundaries, buckets) {
  const counts = new Map(buckets.map((bucket) => [new Date(bucket._id).getTime(), bucket.count]));
  return boundaries.slice(0, -1).map((weekStart, index) => ({
    weekStart,
    weekEnd: boundaries[index + 1],
    count: counts.get(weekStart.getTime()) ?? 0,
  }));
}

// 今天的門診：跟掛號台流程列同一套分段（待報到／在院／待櫃台處理／已完成），取消與未到不算進今日掛號。
// 上午／下午以 12:00 切；在院再分「看診中」（醫師按了開始看診）與「候診」。
// 待安排回診＝醫師寫了回診建議、櫃台還沒掛下一次的號。
export function todayClinic(appointments = []) {
  const active = appointments.filter((item) => !['cancelled', 'no_show'].includes(item.status));
  const onsite = active.filter((item) => item.status === 'arrived');
  const completed = active.filter((item) => item.status === 'completed');
  return {
    total: active.length,
    morning: active.filter((item) => String(item.time ?? '') < '12:00').length,
    afternoon: active.filter((item) => String(item.time ?? '') >= '12:00').length,
    onsite: onsite.length,
    inVisit: onsite.filter((item) => item.visitStartedAt).length,
    waiting: onsite.filter((item) => !item.visitStartedAt).length,
    handoff: active.filter((item) => item.status === 'pending_checkout').length,
    completed: completed.length,
    followUpPending: completed.filter((item) => String(item.followUpRecommendation ?? '').trim() && !item.followUpAppointmentId).length,
  };
}

// pending 跟 failed 都刻意把 uncertain 算進去——「寄送失敗」卡片與它連去的 /records?view=failed、
// 「待寄送」卡片與 /records?view=pending 兩邊的查詢都是這個口徑。
export function deliveryBreakdown(statusBreakdown = {}) {
  const { finalized = 0, sending = 0, uncertain = 0, failed: failedOnly = 0 } = statusBreakdown;
  return { pending: finalized + sending + uncertain, failed: failedOnly + uncertain };
}

router.get('/', async (req, res, next) => {
  try {
    const today = clinicToday();
    const [year, month] = today.split('-');
    const monthStartInput = `${year}-${month}-01`;
    const nextMonthStartInput = month === '12' ? `${Number(year) + 1}-01-01` : `${year}-${String(Number(month) + 1).padStart(2, '0')}-01`;
    const previousMonthStartInput = month === '01' ? `${Number(year) - 1}-12-01` : `${year}-${String(Number(month) - 1).padStart(2, '0')}-01`;
    const startOfMonth = clinicDayStart(monthStartInput);
    const startOfNextMonth = clinicDayStart(nextMonthStartInput);
    const startOfPreviousMonth = clinicDayStart(previousMonthStartInput);
    const trendStart = clinicDayStart(today, -((WEEKS - 1) * 7 + 6));
    const weekBoundaries = buildWeekBoundaries(trendStart);
    const trendEnd = weekBoundaries.at(-1);

    const [todayAppointments, [recordSummary], overdueDraftCount, latestFailed] = await Promise.all([
      Appointment.find({ date: today }).select('time status visitStartedAt followUpRecommendation followUpAppointmentId').lean(),
      MedicalRecord.aggregate([
        { $match: CURRENT_VERSION },
        { $facet: {
          statuses: [{ $group: { _id: { status: '$status', deliveryStatus: '$deliveryStatus' }, count: { $sum: 1 } } }],
          sentThisMonth: [{ $match: { deliveryStatus: 'sent', sentAt: { $gte: startOfMonth, $lt: startOfNextMonth } } }, { $count: 'count' }],
          sentPreviousMonth: [{ $match: { deliveryStatus: 'sent', sentAt: { $gte: startOfPreviousMonth, $lt: startOfMonth } } }, { $count: 'count' }],
          weekly: [{ $match: { visitDate: { $gte: trendStart, $lt: trendEnd } } }, { $bucket: { groupBy: '$visitDate', boundaries: weekBoundaries, output: { count: { $sum: 1 } } } }],
        } },
      ]),
      MedicalRecord.countDocuments({ ...CURRENT_VERSION, status: 'draft', updatedAt: { $lt: new Date(Date.now() - DAY_MS) } }),
      // 橫幅上點名最近一份失敗的：哪隻、為什麼。
      MedicalRecord.findOne({ ...CURRENT_VERSION, status: 'finalized', deliveryStatus: { $in: ['failed', 'uncertain'] } })
        .sort({ lastDeliveryAttemptAt: -1, updatedAt: -1 })
        .select('deliveryStatus deliveryError petId')
        .populate({ path: 'petId', select: 'name' })
        .lean(),
    ]);

    const statusBreakdown = { draft: 0, finalized: 0, sending: 0, sent: 0, failed: 0, uncertain: 0 };
    (recordSummary?.statuses ?? []).forEach(({ _id, count }) => {
      if (_id.status === 'draft') return void (statusBreakdown.draft += count);
      const deliveryStatus = _id.deliveryStatus || 'not_sent';
      if (deliveryStatus === 'sent') statusBreakdown.sent += count;
      else if (deliveryStatus === 'failed') statusBreakdown.failed += count;
      else if (deliveryStatus === 'uncertain') statusBreakdown.uncertain += count;
      else if (deliveryStatus === 'sending') statusBreakdown.sending += count;
      else statusBreakdown.finalized += count;
    });
    const { pending, failed } = deliveryBreakdown(statusBreakdown);

    res.json({
      today: todayClinic(todayAppointments),
      reports: {
        drafts: statusBreakdown.draft,
        overdueDrafts: overdueDraftCount,
        pending,
        failed,
        sentThisMonth: recordSummary?.sentThisMonth?.[0]?.count ?? 0,
        sentPreviousMonth: recordSummary?.sentPreviousMonth?.[0]?.count ?? 0,
      },
      latestFailed: latestFailed ? {
        _id: latestFailed._id,
        petName: latestFailed.petId?.name ?? '',
        deliveryStatus: latestFailed.deliveryStatus,
        error: latestFailed.deliveryError ?? '',
      } : null,
      weeklyTrend: fillWeeklyTrend(weekBoundaries, recordSummary?.weekly ?? []),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
