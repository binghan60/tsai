// 出席紀錄：遲到與未到，直接從掛號算出來（貓咪詳情頁的徽章與「出席紀錄」頁籤、掛號視窗的對照表）。
// 次數不另外存：早期在 pets／owners 上記一份只加不減的累計（attendanceSummary），未到之後被「恢復」、
// 遲到報到之後又「取消報到」都不會扣回去，跟清單的筆數對不起來，已經移除。

// 真的到院的階段。遲到分鐘在報到當下寫入，取消報到時不清，所以要連狀態一起看。
const ATTENDED_STATUSES = ['arrived', 'pending_checkout', 'completed'];
const DEPOSIT_DECISIONS = ['collected', 'waived', 'refunded', 'carried'];

function incidentConditions() {
  return [
    { status: 'no_show' },
    { status: { $in: ATTENDED_STATUSES }, latenessMinutes: { $gt: 0 } },
  ];
}

// 算次數用：只有遲到與未到。scope 是 { petId } 或 { ownerId }；分別接 {petId, date}、{ownerId, date} 索引。
export function attendanceFilter(scope) {
  return { ...scope, $or: incidentConditions() };
}

// 「出席紀錄」清單用：遲到、未到，再加上約診時決定過保證金（已收／這次不收）的掛號——
// 保證金跟遲到是同一條時間線上的事：收了之後次數歸零，列在一起才看得出是哪幾次換來這筆保證金。
export function attendanceListFilter(scope) {
  return { ...scope, $or: [...incidentConditions(), { depositStatus: { $in: DEPOSIT_DECISIONS } }] };
}

// late／no_show 是出席事件；deposit＝這筆掛號本身沒有遲到或未到，只是約診時決定過保證金。
export function attendanceKind(appointment) {
  if (appointment.status === 'no_show') return 'no_show';
  if (ATTENDED_STATUSES.includes(appointment.status) && appointment.latenessMinutes > 0) return 'late';
  return 'deposit';
}

export function attendanceRow(appointment) {
  const kind = attendanceKind(appointment);
  const depositStatus = DEPOSIT_DECISIONS.includes(appointment.depositStatus) ? appointment.depositStatus : '';
  return {
    _id: appointment._id,
    kind,
    date: appointment.date,
    time: appointment.time,
    checkedInAt: kind === 'no_show' ? null : appointment.checkedInAt ?? null,
    latenessMinutes: kind === 'late' ? appointment.latenessMinutes : 0,
    petId: appointment.petId ?? null,
    petName: appointment.petName ?? '',
    reason: appointment.reason ?? '',
    // 只有保證金紀錄的列常常是取消的掛號（收了又取消），清單上要看得出來。
    cancelled: appointment.status === 'cancelled',
    depositStatus,
    depositWaiveReason: depositStatus === 'waived' ? appointment.depositWaiveReason ?? '' : '',
    depositDecidedAt: depositStatus ? appointment.depositDecidedAt ?? null : null,
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
