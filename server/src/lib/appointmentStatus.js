export const APPOINTMENT_STATUSES = ['scheduled', 'arrived', 'completed', 'cancelled', 'no_show'];

const APPOINTMENT_STATUS_LABELS = {
  scheduled: '已預約',
  arrived: '報到',
  completed: '已完成',
  cancelled: '已取消',
  no_show: '未到診',
};

// completed 是終態：完成後不允許再變動狀態，要修正請走編輯備註，不要動狀態。
const ALLOWED_TRANSITIONS = {
  scheduled: ['arrived', 'cancelled', 'no_show'],
  arrived: ['completed', 'cancelled', 'scheduled'],
  no_show: ['scheduled', 'cancelled'],
  cancelled: ['scheduled'],
  completed: [],
};

export function canTransitionAppointmentStatus(from, to) {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

// 留言串只在「現場有人」的期間開放：報到中到已完成。scheduled/cancelled/no_show
// 都還沒有人可以聊，不開放留言。
export const VISIT_MESSAGE_STATUSES = ['arrived', 'completed'];
export function canPostVisitMessage(status) {
  return VISIT_MESSAGE_STATUSES.includes(status);
}

export function describeAppointmentTransition(from, to) {
  const fromLabel = APPOINTMENT_STATUS_LABELS[from] ?? from;
  const toLabel = APPOINTMENT_STATUS_LABELS[to] ?? to;
  return `無法從「${fromLabel}」改為「${toLabel}」`;
}
