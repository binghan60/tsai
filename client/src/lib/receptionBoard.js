// 櫃台看板的純邏輯：遲到判斷與掛號時段格。抽出來是因為頁面元件測不到，
// 而這兩件事都有「差一格就會算錯」的邊界（寬限分鐘數、時段頭尾）。

import { SESSIONS } from './appointmentTimeline.js';

// 一鍵報到時超過預約時間多久才記成遲到。遲到會累計到飼主與寵物的出席紀錄，
// 下次掛號會跳「曾遲到 N 次」提醒——晚兩三分鐘就記一筆，那個提醒很快就沒人看了。
// 遲到分鐘數仍由後端從預約時間起算，寬限只決定「算不算」。
export const LATE_GRACE_MINUTES = 10;

const INACTIVE_STATUSES = new Set(['cancelled', 'no_show']);

function toMinutes(time) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(time ?? ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function toTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

// 還沒報到的掛號已經超過預約時間幾分鐘；已報到或其他狀態一律是 0。
export function minutesPastSchedule(appointment, now = new Date()) {
  if (appointment?.status !== 'scheduled') return 0;
  const scheduledAt = new Date(appointment.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) return 0;
  return Math.max(0, Math.floor((new Date(now).getTime() - scheduledAt.getTime()) / 60000));
}

export function isOverdue(appointment, now = new Date(), grace = LATE_GRACE_MINUTES) {
  return minutesPastSchedule(appointment, now) > grace;
}

// 掛號抽屜的時段格：每個診別切成整點一列、一列 step 分鐘一格，
// 每格帶出已經約在這個時間的掛號，讓櫃台在電話裡就回答得出「兩點半有沒有空」。
//
// - 時段頭尾都可選（11:30、19:30 是合法時段，跟 TimePicker 的 ranges 一致）
// - 整點列裡超出診別範圍的格子 inRange=false，畫面上不給選
// - minTime（今天的現在時間）之前的格子標 past；編輯既有掛號時由元件放行原本選的那格
// - 已取消／未到不佔時段；excludeId 是正在編輯的那一筆，不能自己算自己一位
export function buildSlotGrid(appointments = [], { sessions = SESSIONS, step = 5, excludeId = '', minTime = '' } = {}) {
  const byTime = new Map();
  for (const appointment of appointments ?? []) {
    if (!appointment?.time || INACTIVE_STATUSES.has(appointment.status)) continue;
    if (excludeId && String(appointment._id) === String(excludeId)) continue;
    if (!byTime.has(appointment.time)) byTime.set(appointment.time, []);
    byTime.get(appointment.time).push(appointment);
  }
  const min = toMinutes(minTime);

  return sessions.map((session) => {
    const start = toMinutes(session.start);
    const end = toMinutes(session.end);
    const rows = [];
    for (let hour = Math.floor(start / 60) * 60; hour <= end; hour += 60) {
      const cells = [];
      for (let minute = hour; minute < hour + 60; minute += step) {
        const time = toTime(minute);
        const inRange = minute >= start && minute <= end;
        cells.push({
          time,
          inRange,
          past: min !== null && minute < min,
          entries: inRange ? byTime.get(time) ?? [] : [],
        });
      }
      rows.push({ hour: toTime(hour), cells });
    }
    return { id: session.id, label: session.label, start: session.start, end: session.end, rows };
  });
}
