const APPOINTMENT_STATUS_LABELS = {
  scheduled: '已預約',
  arrived: '報到',
  pending_checkout: '待櫃台處理',
  completed: '已完成',
  cancelled: '已取消',
  no_show: '未到診',
};

// 排班動作（報到、取消、未到、恢復／取消報到）能走的狀態轉換。
// 看診流水線那一段（arrived ⇄ pending_checkout → completed）不在這張表上：那是 lib/appointmentWorkflow.js
// 依三個里程碑推導出來的，不是誰直接指定的。所以送交櫃台之後這裡沒有任何出路——
// 要取消得先由醫師取回、取消看診，退回候診之後才取消得了報到（routes/appointments.js 的 checkWorkflowCompatibility
// 另外擋掉「已經開始看診」的 arrived）。
const ALLOWED_TRANSITIONS = {
  scheduled: ['arrived', 'cancelled', 'no_show'],
  arrived: ['cancelled', 'scheduled'],
  pending_checkout: [],
  completed: [],
  no_show: ['scheduled', 'cancelled'],
  cancelled: ['scheduled'],
};

export function canTransitionAppointmentStatus(from, to) {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function describeAppointmentTransition(from, to) {
  const fromLabel = APPOINTMENT_STATUS_LABELS[from] ?? from;
  const toLabel = APPOINTMENT_STATUS_LABELS[to] ?? to;
  return `無法從「${fromLabel}」改為「${toLabel}」`;
}

// 是否仍持有現場發出的實體號碼牌——候診、看診與待櫃台處理都算「人還在診所」，
// 離開這幾個狀態（完成／取消／取消報到）才歸還號碼牌。
export function holdsCheckinNumber(status) {
  return status === 'arrived' || status === 'pending_checkout';
}
