// 櫃台工作台的純邏輯：遲到判斷、掛號時段格、時段收合與重複掛號。抽出來是因為頁面元件測不到，
// 而這些都有「差一格就會算錯」的邊界（寬限分鐘數、時段頭尾、現在是否已過時段）。

import { SESSIONS } from './appointmentTimeline.js';
import { APPOINTMENT_TIME_MINUTE_STEP, DEFAULT_ESTIMATED_DURATION_MINUTES, SURGERY_TIME_RANGE } from './appointmentTime.js';

// 一鍵報到時超過預約時間多久才記成遲到。遲到會累計到飼主與寵物的出席紀錄，
// 下次掛號會跳「曾遲到 N 次」提醒——晚兩三分鐘就記一筆，那個提醒很快就沒人看了。
// 遲到分鐘數仍由後端從預約時間起算，寬限只決定「算不算」。
export const LATE_GRACE_MINUTES = 10;

// 勾了手術才出現的第三組時段格，夾在上午診與下午診中間。
export const SURGERY_SESSION = { id: 'surgery', label: '手術時間', start: SURGERY_TIME_RANGE[0], end: SURGERY_TIME_RANGE[1], surgery: true };

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

// 掛號時段格的診別清單：一般掛號只有門診兩段，勾了手術多出中間的手術時段。
export function slotSessions({ surgery = false, sessions = SESSIONS } = {}) {
  if (!surgery) return sessions;
  const list = [...sessions];
  const index = list.findIndex((session) => toMinutes(session.start) > toMinutes(SURGERY_SESSION.start));
  list.splice(index < 0 ? list.length : index, 0, SURGERY_SESSION);
  return list;
}

// 掛號抽屜的時段格：每個診別切成整點一列、一列 step 分鐘一格，
// 每格帶出已經約在這個時間的掛號，讓櫃台在電話裡就回答得出「兩點半有沒有空」。
//
// - 時段頭尾都可選（11:30、19:30 是合法時段，跟後端驗證的 ranges 一致）
// - 整點列裡超出診別範圍的格子 inRange=false，畫面上不給選
// - minTime（今天的現在時間）之前的格子標 past；編輯既有掛號時由元件放行原本選的那格
// - 已取消／未到不佔時段；excludeId 是正在編輯的那一筆，不能自己算自己一位
// - surgery=true 時多出手術時段那一組，格子帶 surgery 標記讓畫面用紫色區分
export function buildSlotGrid(appointments = [], { sessions, step = APPOINTMENT_TIME_MINUTE_STEP, excludeId = '', minTime = '', surgery = false } = {}) {
  const byTime = new Map();
  for (const appointment of appointments ?? []) {
    if (!appointment?.time || INACTIVE_STATUSES.has(appointment.status)) continue;
    if (excludeId && String(appointment._id) === String(excludeId)) continue;
    const start = toMinutes(appointment.time);
    const duration = Number(appointment.estimatedDurationMinutes) || DEFAULT_ESTIMATED_DURATION_MINUTES;
    for (let minute = start; minute < start + duration; minute += step) {
      const occupiedTime = toTime(minute);
      if (!byTime.has(occupiedTime)) byTime.set(occupiedTime, []);
      byTime.get(occupiedTime).push({ ...appointment, occupiesFrom: appointment.time, isContinuation: minute !== start });
    }
  }
  const min = toMinutes(minTime);

  return slotSessions({ surgery, sessions }).map((session) => {
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
    return { id: session.id, label: session.label, start: session.start, end: session.end, surgery: Boolean(session.surgery), rows };
  });
}

// 時段格一格裡要顯示的名字：15 分鐘一格時格子夠寬，直接列名字；三人以上只列前兩位加「+N」，
// 不然名字擠成一團反而一個都讀不到。回傳 { names, more }，由元件決定怎麼排。
export function slotCellLabel(entries = [], limit = 2) {
  const names = entries.map((entry) => entry.petName || '未填名字');
  return { names: names.slice(0, limit), more: Math.max(0, names.length - limit) };
}

// 同一隻寵物在同一天已經有的掛號（排除已取消／未到與正在編輯的那一筆）。
// 電話裡飼主常忘記自己早上已經掛過，掛號前先提醒比事後多一筆重複要處理便宜。
export function duplicateBookings(appointments = [], petId, excludeId = '') {
  if (!petId) return [];
  return (appointments ?? []).filter((appointment) => (
    String(appointment.petId ?? '') === String(petId)
    && !INACTIVE_STATUSES.has(appointment.status)
    && !(excludeId && String(appointment._id) === String(excludeId))
  ));
}

// 時間軸某一個時段是否該預設收合：時段已經結束，而且裡面沒有任何還要櫃台動手的掛號。
// 有待處理時不收，收起來就等於把事情藏起來。isPending 由頁面決定（遲到未報到、待櫃台處理都算）。
export function sessionAutoCollapsed(group, { now = new Date(), isToday = true, isPending = () => false } = {}) {
  if (!isToday) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  if (current <= toMinutes(group.session.end)) return false;
  return !group.items.some((item) => isPending(item));
}
