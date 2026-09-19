export const APPOINTMENT_TIME_RANGES = [
  ['10:00', '11:30'],
  ['14:00', '19:30'],
];

// 手術掛在門診中間的手術時段，只有勾了手術的掛號能選；跟後端 routes/appointments.js 同一組數字。
export const SURGERY_TIME_RANGE = ['11:45', '13:45'];

export const APPOINTMENT_TIME_MINUTE_STEP = 15;
export const DEFAULT_ESTIMATED_DURATION_MINUTES = 15;
export const MAX_ESTIMATED_DURATION_MINUTES = 240;
