// 顏色大致沿用 recordStatus.js 同一套語意分工：
// sky＝進行中尚無定論、primary＝目前最該關注的焦點狀態（跟主題切換：淺色 belle／深色 brand）、
// emerald＝正向已完結、bg-muted＝終結但非錯誤、amber＝待處理需要人回頭看。
export const APPOINTMENT_STATUS_META = {
  scheduled: { label: '已預約', class: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300', dotClass: 'bg-sky-600' },
  arrived: { label: '報到', class: 'bg-primary text-primary-foreground', dotClass: 'bg-primary' },
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
