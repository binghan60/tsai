// 顏色沿用 recordStatus.js 同一套語意分工：
// info＝已排進來但還沒發生、primary＝此刻正在診間裡、需要人盯著的那一筆、
// success＝正向已完結、muted＝終結但不是錯誤、warning＝要人回頭處理。
// 一律走語意 token，不再有淺色一組色階、深色另一組色階的雙寫。
export const APPOINTMENT_STATUS_META = {
  scheduled: { label: '已預約', class: 'bg-info-surface text-info', dotClass: 'bg-info' },
  arrived: { label: '報到', class: 'bg-primary text-primary-foreground', dotClass: 'bg-primary' },
  completed: { label: '已完成', class: 'bg-success-surface text-success', dotClass: 'bg-success' },
  cancelled: { label: '已取消', class: 'bg-muted text-muted-foreground', dotClass: 'bg-muted-foreground' },
  no_show: { label: '未到診', class: 'bg-warning-surface text-warning', dotClass: 'bg-warning' },
};

export const APPOINTMENT_VIEWS = [
  { key: 'all', label: '全部', tone: 'neutral' },
  { key: 'scheduled', label: APPOINTMENT_STATUS_META.scheduled.label, tone: 'info' },
  { key: 'arrived', label: APPOINTMENT_STATUS_META.arrived.label, tone: 'primary' },
  { key: 'completed', label: APPOINTMENT_STATUS_META.completed.label, tone: 'success' },
  { key: 'no_show', label: APPOINTMENT_STATUS_META.no_show.label, tone: 'warning' },
  { key: 'cancelled', label: APPOINTMENT_STATUS_META.cancelled.label, tone: 'neutral' },
];
