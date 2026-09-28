// 掛號時段規則：新增／修改掛號與初診表審核（routes/intakeSubmissions.js）共用同一套，
// 前端 client/src/lib/appointmentTime.js 是同一組數字。
// 手術只是掛號上的標記（isSurgery／surgeryName），時段跟一般門診一樣，沒有專屬的手術時段。
export const APPOINTMENT_TIME_RANGES = [
  ['10:00', '11:30'],
  ['14:00', '19:30'],
];
export const APPOINTMENT_TIME_STEP = 15;
export const MAX_ESTIMATED_DURATION_MINUTES = 240;
export const APPOINTMENT_TIME_ERROR = '預約時段僅限 10:00–11:30、14:00–19:30，且每 15 分鐘一格';

function minutesOfTime(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

// 空值算合法（電話掛號可以先不指定時段）；要必填的呼叫端自己先擋。
export function isValidAppointmentTime(value) {
  if (!value) return true;
  const minutes = minutesOfTime(value);
  if (minutes == null || minutes % APPOINTMENT_TIME_STEP !== 0) return false;
  return APPOINTMENT_TIME_RANGES.some(([start, end]) => {
    const startMinutes = minutesOfTime(start);
    const endMinutes = minutesOfTime(end);
    return minutes >= startMinutes && minutes <= endMinutes;
  });
}

export function normalizeEstimatedDuration(value) {
  const duration = value === undefined || value === null || value === '' ? APPOINTMENT_TIME_STEP : Number(value);
  if (!Number.isSafeInteger(duration) || duration < APPOINTMENT_TIME_STEP || duration > MAX_ESTIMATED_DURATION_MINUTES || duration % APPOINTMENT_TIME_STEP !== 0) {
    throw Object.assign(new Error('預估診療時間須為 15–240 分鐘，且以 15 分鐘為單位'), { status: 422 });
  }
  return duration;
}

export function validateAppointmentDuration(time, duration) {
  if (!time) return;
  const startAt = minutesOfTime(time);
  const valid = APPOINTMENT_TIME_RANGES.some(([start, end]) => (
    startAt >= minutesOfTime(start)
    && startAt + duration <= minutesOfTime(end) + APPOINTMENT_TIME_STEP
  ));
  if (!valid) throw Object.assign(new Error('預估診療時間超出可掛號時段，請縮短時間或改選其他時段'), { status: 422 });
}
