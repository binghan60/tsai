// 出席紀錄：遲到與未到，直接從掛號算出來（貓咪詳情頁的徽章與「出席紀錄」頁籤）。
// 不讀 pets／owners 上的 attendanceSummary——那是只加不減的累計，未到之後被「恢復」、
// 遲到報到之後又「取消報到」都不會扣回去，拿來當徽章數字會跟清單的筆數對不起來。

// 真的到院的階段。遲到分鐘在報到當下寫入，取消報到時不清，所以要連狀態一起看。
const ATTENDED_STATUSES = ['arrived', 'pending_checkout', 'completed'];

// scope 是 { petId } 或 { ownerId }；分別接 {petId, date}、{ownerId, date} 索引。
export function attendanceFilter(scope) {
  return {
    ...scope,
    $or: [
      { status: 'no_show' },
      { status: { $in: ATTENDED_STATUSES }, latenessMinutes: { $gt: 0 } },
    ],
  };
}

export function attendanceKind(appointment) {
  return appointment.status === 'no_show' ? 'no_show' : 'late';
}

export function attendanceRow(appointment) {
  const kind = attendanceKind(appointment);
  return {
    _id: appointment._id,
    kind,
    date: appointment.date,
    time: appointment.time,
    checkedInAt: kind === 'late' ? appointment.checkedInAt ?? null : null,
    latenessMinutes: kind === 'late' ? appointment.latenessMinutes : 0,
    petId: appointment.petId ?? null,
    petName: appointment.petName ?? '',
    reason: appointment.reason ?? '',
  };
}

// 分組統計的 pipeline：一組遲到、一組未到，各帶次數與最近一次的日期（YYYY-MM-DD 字串可直接比大小）。
export function attendanceCountPipeline(scope) {
  return [
    { $match: attendanceFilter(scope) },
    {
      $group: {
        _id: { $cond: [{ $eq: ['$status', 'no_show'] }, 'no_show', 'late'] },
        count: { $sum: 1 },
        lastDate: { $max: '$date' },
      },
    },
  ];
}

export function attendanceCounts(groups = []) {
  const byKind = new Map(groups.map((group) => [group._id, group]));
  const late = byKind.get('late');
  const noShow = byKind.get('no_show');
  return {
    lateCount: late?.count ?? 0,
    lastLateDate: late?.lastDate ?? null,
    noShowCount: noShow?.count ?? 0,
    lastNoShowDate: noShow?.lastDate ?? null,
  };
}
