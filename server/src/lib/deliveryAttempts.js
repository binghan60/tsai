import mongoose from 'mongoose';
import { escapeRegExp } from './regex.js';
import { clinicDayStart } from './clinicTime.js';

export const DELIVERY_EVENTS = ['queued', 'sent', 'failed', 'uncertain'];

// 寄送流水帳一次寄送會寫兩筆（先 queued，再 sent／failed／uncertain），用 attemptId 串起來；
// 畫面上是「一次寄送一列」。合併要在資料庫裡、分頁之前做：以前是分頁完才在前端合併，
// 總數算的是事件、一頁 10 筆事件只剩五六列，同一次寄送的兩筆還可能被切到兩頁，
// 前一頁顯示「寄送中」、後一頁又冒出一筆「寄送成功」。
//
// 沒有 attemptId 的紀錄各自算一次寄送（專案尚未上線，不做舊資料的時間窗配對）。
export function deliveryAttemptPipeline(query = {}, { page = 1, limit = 10 } = {}) {
  // 這幾個條件同一次寄送的每一筆事件都一樣，可以先篩、吃得到 recordId 索引。
  const before = {};
  if (query.recordId) {
    if (!mongoose.isValidObjectId(query.recordId)) return null;
    before.recordId = new mongoose.Types.ObjectId(String(query.recordId));
  }
  const keyword = String(query.q ?? '').trim();
  if (keyword) {
    const pattern = new RegExp(escapeRegExp(keyword), 'i');
    before.$or = [{ recipient: pattern }, { petName: pattern }, { ownerName: pattern }];
  }

  // 結果與日期看的是「這次寄送」：結果是最後一筆事件，日期是它最後有動靜的時間（跟畫面上顯示的時間同一個）。
  // 「寄送中」因此自然就是還沒有結果的那些，不會把已寄出那次的 queued 也算進去。
  // 日期是診所的那一天，邊界用診所時區換算；to 要含當天整天，取隔天的開頭當上界。
  const after = {};
  if (DELIVERY_EVENTS.includes(query.event)) after.event = query.event;
  const from = clinicDayStart(query.from);
  const to = clinicDayStart(query.to, 1);
  if (from || to) after.latestAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };

  return [
    { $match: before },
    { $sort: { createdAt: 1, _id: 1 } },
    {
      $group: {
        _id: { $cond: [{ $gt: ['$attemptId', ''] }, '$attemptId', { $toString: '$_id' }] },
        last: { $last: '$$ROOT' },
        // $min 會略過 null，沒有 queued 的就是 null。
        startedAt: { $min: { $cond: [{ $eq: ['$event', 'queued'] }, '$createdAt', null] } },
        latestAt: { $max: '$createdAt' },
      },
    },
    {
      $replaceRoot: {
        newRoot: {
          $mergeObjects: [
            '$last',
            {
              startedAt: '$startedAt',
              completedAt: { $cond: [{ $eq: ['$last.event', 'queued'] }, null, '$last.createdAt'] },
              latestAt: '$latestAt',
            },
          ],
        },
      },
    },
    { $match: after },
    // Message-ID 是 SMTP 供應商的技術識別碼，介面用不到，留在資料庫供除錯即可。
    { $project: { messageId: 0 } },
    {
      $facet: {
        items: [{ $sort: { latestAt: -1, _id: -1 } }, { $skip: (page - 1) * limit }, { $limit: limit }],
        total: [{ $count: 'count' }],
      },
    },
  ];
}
