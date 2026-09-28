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

export const DURATION_OVERFLOW_ERROR = '預估診療時間超出可掛號時段，請縮短時間或改選其他時段';

// 預估診療時間要塞得進開始時間所在的那個診別；時段格一選就即時提示，不等按下送出。
export function durationOverflowError(time, durationMinutes = DEFAULT_ESTIMATED_DURATION_MINUTES) {
  const start = toMinutes(time);
  if (start === null) return '';
  const range = APPOINTMENT_TIME_RANGES.find(([from, to]) => start >= toMinutes(from) && start <= toMinutes(to));
  if (!range) return '';
  return start + Number(durationMinutes) <= toMinutes(range[1]) + APPOINTMENT_TIME_MINUTE_STEP ? '' : DURATION_OVERFLOW_ERROR;
}

// 所有排掛號的地方（掛號視窗、櫃台約回診、初診表審核）送出前都拿這個驗，跟後端同一套：
// 日期、時段都必填；時段落在診別內、15 分鐘一格；預估診療時間要塞得進同一個診別。
// 今天已經過去的時間照樣能選——現場常要補登早上已經來過的貓，鎖住反而掛不進去。
export function appointmentSlotErrors({ date, time, durationMinutes = DEFAULT_ESTIMATED_DURATION_MINUTES }) {
  const errors = {};
  if (!date) errors.date = '請選擇掛號日期';
  const start = toMinutes(time);
  if (!time) errors.time = '請選擇預約時段';
  else if (start === null || start % APPOINTMENT_TIME_MINUTE_STEP !== 0 || !APPOINTMENT_TIME_RANGES.some(([from, to]) => start >= toMinutes(from) && start <= toMinutes(to))) errors.time = APPOINTMENT_TIME_ERROR;
  else if (durationOverflowError(time, durationMinutes)) errors.time = DURATION_OVERFLOW_ERROR;
  return errors;
}
