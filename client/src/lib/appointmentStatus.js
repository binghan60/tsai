// 顏色全部沿用既有 token，跟 recordStatus.js 同一套語意分工：
// sky＝進行中尚無定論、brand＝目前最該關注的焦點狀態、emerald＝正向已完結、
// bg-muted＝終結但非錯誤、amber＝待處理需要人回頭看。
export const APPOINTMENT_STATUS_META = {
  scheduled: { label: '已預約', class: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300', dotClass: 'bg-sky-600' },
  arrived: { label: '已到診', class: 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300', dotClass: 'bg-brand-600' },
  completed: { label: '已完成', class: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400', dotClass: 'bg-emerald-600' },
  cancelled: { label: '已取消', class: 'bg-muted text-muted-foreground', dotClass: 'bg-muted-foreground' },
  no_show: { label: '未到診', class: 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300', dotClass: 'bg-amber-600' },
};

export const APPOINTMENT_VIEWS = [
  { key: 'all', label: '全部', tone: 'neutral' },
  { key: 'scheduled', label: APPOINTMENT_STATUS_META.scheduled.label, tone: 'info' },
  { key: 'arrived', label: APPOINTMENT_STATUS_META.arrived.label, tone: 'primary' },
  { key: 'completed', label: APPOINTMENT_STATUS_META.completed.label, tone: 'success' },
  { key: 'no_show', label: APPOINTMENT_STATUS_META.no_show.label, tone: 'warning' },
  { key: 'cancelled', label: APPOINTMENT_STATUS_META.cancelled.label, tone: 'neutral' },
];
