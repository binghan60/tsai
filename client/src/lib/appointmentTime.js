export const APPOINTMENT_TIME_RANGES = [
  ['10:00', '11:30'],
  ['14:00', '19:30'],
];

export const APPOINTMENT_TIME_MINUTE_STEP = 15;
export const DEFAULT_ESTIMATED_DURATION_MINUTES = 15;
export const MAX_ESTIMATED_DURATION_MINUTES = 240;

// 後端 server/src/lib/appointmentTime.js 同一段文字與規則。
export const APPOINTMENT_TIME_ERROR = '預約時段僅限 10:00–11:30、14:00–19:30，且每 15 分鐘一格';

function toMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

// 用時間選單（不是時段格）排掛號的地方——例如初診表審核——拿這個驗，規則跟掛號視窗的時段格一致：
// 日期、時段都必填；時段落在診別內、15 分鐘一格；今天已經過去的時間不能選；預估診療時間要塞得進同一個診別。
export function appointmentSlotErrors({ date, time, durationMinutes = DEFAULT_ESTIMATED_DURATION_MINUTES, today = '', nowTime = '' }) {
  const errors = {};
  if (!date) errors.date = '請選擇掛號日期';
  const start = toMinutes(time);
  if (!time) errors.time = '請選擇預約時段';
  else if (start === null || start % APPOINTMENT_TIME_MINUTE_STEP !== 0 || !APPOINTMENT_TIME_RANGES.some(([from, to]) => start >= toMinutes(from) && start <= toMinutes(to))) errors.time = APPOINTMENT_TIME_ERROR;
  else if (date && date === today && nowTime && start < toMinutes(nowTime)) errors.time = '這個時段已經過了，請改選其他時段';
  else if (!APPOINTMENT_TIME_RANGES.some(([from, to]) => start >= toMinutes(from) && start + Number(durationMinutes) <= toMinutes(to) + APPOINTMENT_TIME_MINUTE_STEP)) errors.time = '預估診療時間超出可掛號時段，請縮短時間或改選其他時段';
  return errors;
}
