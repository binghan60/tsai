import { Router } from 'express';
import Owner from '../models/Owner.js';
import Pet from '../models/Pet.js';
import MedicalRecord from '../models/MedicalRecord.js';
import { clinicDayStart, clinicToday } from '../lib/clinicTime.js';

const router = Router();

const WEEKS = 6;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// 邊界是「診所時區的某天 00:00」對應的實際時刻，所以往後推是加整整七天的毫秒數，
// 不是 setDate()——後者算的是伺服器本地日期，伺服器落在有日光節約的時區時會偏一小時。
// 台北本身沒有日光節約，加固定毫秒數不會讓邊界離開當地午夜。
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

// 儀錶板的每一個數字都只算「同一次健檢的最新版」，跟 GET /api/records 的佇列同一套判準。
// 少了這層，一份改過三次的報告會在統計裡算三次，而點進去的清單只列一列——
// 卡片正是為了點進去而存在的，兩邊對不上會直接讓人懷疑哪一邊在騙人。
// 草稿不可能被取代（supersededBy 只會標在被修訂的已結案報告上），對它們是無害的贅詞，
// 但寧可統一寫上：規則只有一條時才不會有人在新增查詢時漏掉。
const CURRENT_VERSION = { supersededBy: null };

router.get('/', async (req, res, next) => {
  try {
    // 「本月」與「近六週」指的是診所的月份與日期，不是伺服器所在時區的。
    // 正式環境跑 UTC，用 new Date(年, 月, 1) 會讓區間整段偏移八小時，
    // 月初與月底那幾個小時的數字會跟寄送紀錄頁（已改用 clinicDayStart）對不起來。
    const today = clinicToday();
    const [year, month] = today.split('-');
    const startOfMonth = clinicDayStart(`${year}-${month}-01`);
    const startOfNextMonth = clinicDayStart(
      month === '12' ? `${Number(year) + 1}-01-01` : `${year}-${String(Number(month) + 1).padStart(2, '0')}-01`
    );
    // 趨勢的最後一週要含今天，所以往前推 (WEEKS-1) 個整週再退到那一週的週首。
    const trendStart = clinicDayStart(today, -((WEEKS - 1) * 7 + 6));
    const weekBoundaries = buildWeekBoundaries(trendStart);
    const trendEnd = weekBoundaries.at(-1);

    const monthRange = { $gte: startOfMonth, $lt: startOfNextMonth };

    const [
      ownerCount,
      petCount,
      monthlyNewOwnerCount,
      monthlyNewPetCount,
      [summary],
      recentRecords,
      draftRecords,
      attentionRecords,
      pendingRecords,
    ] = await Promise.all([
        Owner.countDocuments(),
        Pet.countDocuments(),
        Owner.countDocuments({ createdAt: monthRange }),
        Pet.countDocuments({ createdAt: monthRange }),
        MedicalRecord.aggregate([
          { $match: CURRENT_VERSION },
          {
            $facet: {
              monthly: [
                { $match: { visitDate: { $gte: startOfMonth, $lt: startOfNextMonth } } },
                { $count: 'count' },
              ],
              drafts: [{ $match: { status: 'draft' } }, { $count: 'count' }],
              statuses: [
                { $group: { _id: { status: '$status', deliveryStatus: '$deliveryStatus' }, count: { $sum: 1 } } },
              ],
              weekly: [
                { $match: { visitDate: { $gte: trendStart, $lt: trendEnd } } },
                { $bucket: { groupBy: '$visitDate', boundaries: weekBoundaries, output: { count: { $sum: 1 } } } },
              ],
            },
          },
        ]),
        MedicalRecord.find({ ...CURRENT_VERSION, status: { $ne: 'draft' }, deliveryStatus: 'sent' })
          .sort({ sentAt: -1, updatedAt: -1 })
          .limit(5)
          .populate({ path: 'petId', select: 'name species medicalRecordNumber ownerId', populate: { path: 'ownerId', select: 'name phone' } }),
        MedicalRecord.find({ ...CURRENT_VERSION, status: 'draft' })
          .sort({ updatedAt: -1 })
          .limit(5)
          .populate({ path: 'petId', select: 'name species medicalRecordNumber ownerId', populate: { path: 'ownerId', select: 'name phone' } }),
        MedicalRecord.find({
          ...CURRENT_VERSION,
          status: { $ne: 'draft' },
          deliveryStatus: { $in: ['failed', 'uncertain'] },
        })
          .sort({ lastDeliveryAttemptAt: -1, updatedAt: -1 })
          .limit(5)
          .populate({ path: 'petId', select: 'name species medicalRecordNumber ownerId', populate: { path: 'ownerId', select: 'name phone' } }),
        MedicalRecord.find({
          ...CURRENT_VERSION,
          status: { $ne: 'draft' },
          $or: [
            { deliveryStatus: { $in: ['not_sent', 'sending'] } },
            { deliveryStatus: { $exists: false } },
          ],
        })
          .sort({ finalizedAt: -1, updatedAt: -1 })
          .limit(5)
          .populate({ path: 'petId', select: 'name species medicalRecordNumber ownerId', populate: { path: 'ownerId', select: 'name phone' } }),
      ]);

    const monthlyReportCount = summary?.monthly?.[0]?.count ?? 0;
    const draftCount = summary?.drafts?.[0]?.count ?? 0;
    const weeklyTrend = fillWeeklyTrend(weekBoundaries, summary?.weekly ?? []);

    const statusBreakdown = { draft: 0, finalized: 0, sending: 0, sent: 0, failed: 0, uncertain: 0 };
    (summary?.statuses ?? []).forEach(({ _id, count }) => {
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

    // 工作台只保留一份有明確優先順序的待辦：寄送異常 → 待寄送／寄送中 → 草稿。
    // 每類查詢各自限量，再去重截斷，避免某一類大量資料把其他需要處理的狀態完全擠掉。
    const actionRecords = prioritizeActionRecords(attentionRecords, pendingRecords, draftRecords);

    res.json({
      ownerCount,
      petCount,
      monthlyNewOwnerCount,
      monthlyNewPetCount,
      monthlyReportCount,
      draftCount,
      finalizedPendingCount: statusBreakdown.finalized + statusBreakdown.sending + statusBreakdown.uncertain,
      failedCount: statusBreakdown.failed + statusBreakdown.uncertain,
      statusBreakdown,
      weeklyTrend,
      recentRecords,
      draftRecords,
      actionRecords,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
