import { Router } from 'express';
import Owner from '../models/Owner.js';
import Pet from '../models/Pet.js';
import MedicalRecord from '../models/MedicalRecord.js';
import Appointment from '../models/Appointment.js';
import { clinicDayStart, clinicToday } from '../lib/clinicTime.js';

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
    weekEnd: boundaries[index + 1],
    count: counts.get(weekStart.getTime()) ?? 0,
  }));
}

export function prioritizeActionRecords(attentionRecords = [], pendingRecords = [], draftRecords = [], limit = 8) {
  const seen = new Set();
  return [...attentionRecords, ...pendingRecords, ...draftRecords]
    .filter((record) => {
      const id = String(record._id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, limit);
}

export function appointmentStatusCounts(buckets = []) {
  const counts = { scheduled: 0, arrived: 0, completed: 0, cancelled: 0, no_show: 0 };
  buckets.forEach(({ _id, count }) => {
    if (_id in counts) counts[_id] = count;
  });
  return counts;
}

export function deliveryRate({ sent = 0, pending = 0, failed = 0 } = {}) {
  const total = sent + pending + failed;
  return total ? Math.round((sent / total) * 100) : null;
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
    const monthRange = { $gte: startOfMonth, $lt: startOfNextMonth };
    const previousMonthRange = { $gte: startOfPreviousMonth, $lt: startOfMonth };

    const [ownerCount, petCount, monthlyNewOwnerCount, monthlyNewPetCount, [recordSummary], todayAppointmentBuckets, monthAppointmentBuckets, previousMonthAppointmentBuckets, overdueDraftCount] = await Promise.all([
      Owner.countDocuments(),
      Pet.countDocuments(),
      Owner.countDocuments({ createdAt: monthRange }),
      Pet.countDocuments({ createdAt: monthRange }),
      MedicalRecord.aggregate([
        { $match: CURRENT_VERSION },
        { $facet: {
          monthly: [{ $match: { visitDate: monthRange } }, { $count: 'count' }],
          previousMonthly: [{ $match: { visitDate: previousMonthRange } }, { $count: 'count' }],
          drafts: [{ $match: { status: 'draft' } }, { $count: 'count' }],
          statuses: [{ $group: { _id: { status: '$status', deliveryStatus: '$deliveryStatus' }, count: { $sum: 1 } } }],
          weekly: [{ $match: { visitDate: { $gte: trendStart, $lt: trendEnd } } }, { $bucket: { groupBy: '$visitDate', boundaries: weekBoundaries, output: { count: { $sum: 1 } } } }],
        } },
      ]),
      Appointment.aggregate([{ $match: { date: today } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Appointment.aggregate([{ $match: { date: { $gte: monthStartInput, $lt: nextMonthStartInput } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Appointment.aggregate([{ $match: { date: { $gte: previousMonthStartInput, $lt: monthStartInput } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      MedicalRecord.countDocuments({ ...CURRENT_VERSION, status: 'draft', updatedAt: { $lt: new Date(Date.now() - DAY_MS) } }),
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

    const todayCounts = appointmentStatusCounts(todayAppointmentBuckets);
    const monthCounts = appointmentStatusCounts(monthAppointmentBuckets);
    const previousMonthCounts = appointmentStatusCounts(previousMonthAppointmentBuckets);
    const pending = statusBreakdown.finalized + statusBreakdown.sending + statusBreakdown.uncertain;
    const failed = statusBreakdown.failed + statusBreakdown.uncertain;

    res.json({
      ownerCount, petCount, monthlyNewOwnerCount, monthlyNewPetCount,
      monthlyReportCount: recordSummary?.monthly?.[0]?.count ?? 0,
      previousMonthlyReportCount: recordSummary?.previousMonthly?.[0]?.count ?? 0,
      draftCount: recordSummary?.drafts?.[0]?.count ?? 0,
      today: { total: Object.values(todayCounts).reduce((sum, count) => sum + count, 0), ...todayCounts },
      monthlyAppointments: { total: Object.values(monthCounts).reduce((sum, count) => sum + count, 0), checkedIn: monthCounts.arrived + monthCounts.completed, cancelledOrNoShow: monthCounts.cancelled + monthCounts.no_show, ...monthCounts },
      previousMonthlyAppointments: { total: Object.values(previousMonthCounts).reduce((sum, count) => sum + count, 0), completed: previousMonthCounts.completed },
      delivery: { sent: statusBreakdown.sent, pending, failed, overdueDraftCount, successRate: deliveryRate({ sent: statusBreakdown.sent, pending, failed }) },
      statusBreakdown,
      weeklyTrend: fillWeeklyTrend(weekBoundaries, recordSummary?.weekly ?? []),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
