import { clinicDateInput, clinicTimeInput, shiftDateInput, weekdayLabel } from './datetime.js';

// 聊天室的日期呈現，跟 LINE／Messenger 一樣：換天的地方插一條置中的日期分隔，
// 每則訊息的時間也帶日期（今天只寫時間），捲到一半也看得出是哪天說的。一律以診所時區的日期算。

// 分隔條上的字：今天、昨天、9/26（週六）；不同年再加年份。
export function chatDayLabel(day, now = new Date()) {
  const today = clinicDateInput(now);
  if (!day || !today) return '';
  if (day === today) return '今天';
  if (day === shiftDateInput(today, -1)) return '昨天';
  const [year, month, date] = day.split('-').map(Number);
  const prefix = day.slice(0, 4) === today.slice(0, 4) ? '' : `${year}/`;
  return `${prefix}${month}/${date}（${weekdayLabel(day)}）`;
}

// 訊息旁的時間：今天「14:30」、昨天「昨天 14:30」、更早「9/26 14:30」，不同年「2025/12/31 14:30」。
export function chatTimeLabel(value, now = new Date()) {
  const day = clinicDateInput(value);
  const time = clinicTimeInput(value);
  const today = clinicDateInput(now);
  if (!day || !time) return '';
  if (day === today) return time;
  if (day === shiftDateInput(today, -1)) return `昨天 ${time}`;
  const [year, month, date] = day.split('-').map(Number);
  const prefix = day.slice(0, 4) === today.slice(0, 4) ? '' : `${year}/`;
  return `${prefix}${month}/${date} ${time}`;
}

// 依時間排好的訊息，在每一天的第一則前面插入日期分隔。
// 回傳 [{ type: 'day', key, label } | { type: 'message', key, message }]。
export function chatTimeline(messages, now = new Date()) {
  const rows = [];
  let previous = '';
  for (const message of messages ?? []) {
    const day = clinicDateInput(message.createdAt);
    if (day && day !== previous) {
      rows.push({ type: 'day', key: `day-${day}`, label: chatDayLabel(day, now) });
      previous = day;
    }
    rows.push({ type: 'message', key: message._id, message });
  }
  return rows;
}
