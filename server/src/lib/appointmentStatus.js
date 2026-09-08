export const APPOINTMENT_STATUSES = ['scheduled', 'arrived', 'pending_checkout', 'completed', 'cancelled', 'no_show'];

const APPOINTMENT_STATUS_LABELS = {
  scheduled: '已預約',
  arrived: '報到',
  pending_checkout: '待櫃台處理',
  completed: '已完成',
  cancelled: '已取消',
  no_show: '未到診',
};

// completed 是終態：完成後不允許再變動狀態，要修正請走編輯備註，不要動狀態。
// arrived → completed 沒有直接路徑：醫師看完一律先進 pending_checkout（已交櫃台、待處理），
// 由櫃台按「完成處理」才真正 completed，中間留一個明確的交接點。
// pending_checkout → arrived 是「取回這筆」：櫃台還沒處理完之前，醫師可以取回修改。
const ALLOWED_TRANSITIONS = {
  scheduled: ['arrived', 'cancelled', 'no_show'],
  arrived: ['pending_checkout', 'cancelled', 'scheduled'],
  pending_checkout: ['completed', 'arrived', 'cancelled'],
  no_show: ['scheduled', 'cancelled'],
  cancelled: ['scheduled'],
  completed: [],
};

export function canTransitionAppointmentStatus(from, to) {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function describeAppointmentTransition(from, to) {
  const fromLabel = APPOINTMENT_STATUS_LABELS[from] ?? from;
  const toLabel = APPOINTMENT_STATUS_LABELS[to] ?? to;
  return `無法從「${fromLabel}」改為「${toLabel}」`;
}

// 是否仍持有現場發出的實體號碼牌——候診中與待結帳都算「人還在診所」，
// 離開這兩個狀態（完成/取消/未到）才歸還號碼牌。見 routes/appointments.js 的 saveLeavingQueue。
export function holdsCheckinNumber(status) {
  return status === 'arrived' || status === 'pending_checkout';
}
