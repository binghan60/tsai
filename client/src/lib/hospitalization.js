import { normalizeRichText, richTextToPlain } from '../../../shared/richText.js';
import { clinicDateInput, clinicTimeInput, combineClinicDateTime, shortDate } from './datetime.js';

// 住院專區的純邏輯：照護時間軸怎麼分天、每筆列哪幾欄、新增／修改表單送出什麼、體重變化。
// 規則見 CLAUDE.md 第三節 hospitalizations。

// 照護紀錄一筆可填的欄位：時間（HH:MM，送出時跟那一天組回 recordedAt）、食物放置、灌食、用藥、其他、體重、體溫。
export const ENTRY_FIELDS = ['time', 'food', 'forceFeeding', 'medication', 'other', 'weightKg', 'temperatureC'];

export const ENTRY_FIELD_LABELS = {
  time: '時間',
  food: '食物放置',
  forceFeeding: '灌食',
  medication: '用藥',
  other: '其他',
  weightKg: '體重',
  temperatureC: '體溫',
};

export const STAFF_LABELS = { vet: '醫師', front_desk: '櫃台' };

const TIME_PATTERN = /^\d{2}:\d{2}$/;

// 伺服器的文件 → 表單的值（一律字串：輸入框是文字框，體溫回來是數字）。
export function entryDraft(entry) {
  return {
    time: clinicTimeInput(entry?.recordedAt),
    food: entry?.food ?? '',
    forceFeeding: entry?.forceFeeding ?? '',
    medication: entry?.medication ?? '',
    other: entry?.other ?? '',
    weightKg: entry?.weightKg === null || entry?.weightKg === undefined ? '' : String(entry.weightKg),
    temperatureC: entry?.temperatureC === null || entry?.temperatureC === undefined ? '' : String(entry.temperatureC),
  };
}

export function emptyEntryDraft(time = '') {
  return { time, food: '', forceFeeding: '', medication: '', other: '', weightKg: '', temperatureC: '' };
}

// 跟伺服器存的樣子一樣整理過的值：伺服器會去掉頭尾空白、用藥會 normalizeRichText、體溫存成數字。
// 「有沒有改」一律比整理過的值，多打一個空白不算改過。
export function normalizedField(key, value) {
  const text = String(value ?? '');
  if (key === 'medication') return normalizeRichText(text).trim();
  if (key === 'temperatureC' || key === 'weightKg') {
    const trimmed = text.trim();
    if (!trimmed) return '';
    const number = Number(trimmed);
    return Number.isFinite(number) ? String(number) : trimmed;
  }
  return text.trim();
}

function sameField(key, a, b) {
  return normalizedField(key, a) === normalizedField(key, b);
}

export function hasEntryChanges(draft, baseline) {
  return ENTRY_FIELDS.some((key) => !sameField(key, draft[key], baseline[key]));
}

// 除了時間以外一欄都沒填：不能新增（沒有東西可記）。
export function isEmptyEntry(draft) {
  return ENTRY_FIELDS.filter((key) => key !== 'time').every((key) => {
    const value = key === 'medication' ? richTextToPlain(draft[key] ?? '') : draft[key];
    return !String(value ?? '').trim();
  });
}

export function validTime(time) {
  return TIME_PATTERN.test(String(time ?? ''));
}

function recordedAt(date, time) {
  const at = validTime(time) ? combineClinicDateTime(date, time) : null;
  return at ? at.toISOString() : null;
}

// 新增：整筆送出。時間跟那一天組回時刻。
export function entryPayload(draft, date) {
  return {
    recordedAt: recordedAt(date, draft.time),
    food: draft.food,
    forceFeeding: draft.forceFeeding,
    medication: draft.medication,
    other: draft.other,
    weightKg: String(draft.weightKg ?? '').trim(),
    temperatureC: String(draft.temperatureC ?? '').trim(),
  };
}

// 修改：只送有變的欄位（照護紀錄不會換天，換天就是記錯了，刪掉重記）。
export function entryPatch(draft, baseline, date) {
  const patch = {};
  for (const key of ENTRY_FIELDS) {
    if (sameField(key, draft[key], baseline[key])) continue;
    if (key === 'time') {
      const at = recordedAt(date, draft.time);
      if (at) patch.recordedAt = at;
      continue;
    }
    patch[key] = key === 'temperatureC' || key === 'weightKg' ? String(draft[key] ?? '').trim() : draft[key];
  }
  return patch;
}

// 時間軸上一筆只列有填的欄位（只記了灌食的那筆就只有一行）。
export function filledFields(entry) {
  const fields = [];
  for (const key of ['food', 'forceFeeding', 'medication', 'other']) {
    const value = entry?.[key] ?? '';
    const text = key === 'medication' ? richTextToPlain(value) : value;
    if (String(text).trim()) fields.push({ key, label: ENTRY_FIELD_LABELS[key], value, rich: key === 'medication' });
  }
  if (entry?.weightKg !== null && entry?.weightKg !== undefined && entry.weightKg !== '') {
    fields.push({ key: 'weightKg', label: ENTRY_FIELD_LABELS.weightKg, value: `${entry.weightKg} kg`, mono: true });
  }
  if (entry?.temperatureC !== null && entry?.temperatureC !== undefined && entry.temperatureC !== '') {
    fields.push({ key: 'temperatureC', label: ENTRY_FIELD_LABELS.temperatureC, value: `${entry.temperatureC} °C`, mono: true });
  }
  return fields;
}

// 某一天的照護紀錄（recordedAt 落在那天，診所時區），照時間先後。
export function entriesOnDate(entries, date) {
  return (entries ?? [])
    .filter((entry) => clinicDateInput(entry.recordedAt) === date)
    .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt) || String(a._id).localeCompare(String(b._id)));
}

// 時間軸分天：最新的一天在最上面，一天之內照時間先後（跟紙本一樣往下寫）。
export function daySections(dates, entries) {
  return (dates ?? [])
    .map((date, index) => ({ date, dayNumber: index + 1, entries: entriesOnDate(entries, date) }))
    .reverse();
}

// 新增一筆的預設時間：記今天就是現在；補記過去的日子預設那天中午。
export function newEntryTime(date, now = new Date()) {
  return clinicDateInput(now) === date ? now : combineClinicDateTime(date, '12:00');
}

// 跟上一次比的差：「−0.12」「+0.03」「±0」。
function deltaLabel(from, to) {
  const diff = Math.round((to - from) * 100) / 100;
  return diff === 0 ? '±0' : `${diff > 0 ? '+' : '−'}${Math.abs(diff)}`;
}

// 病歷日誌「住院」列出院後的摘要：一筆一列。體重、體溫是同一筆照護紀錄量的（同一個 recordedAt）就在同一列，
// 共用時間這條縱軸；只量了其中一樣，另一格留白。日期只在每天的第一列出現。
// 體重帶跟上一次的差（第一筆跟入院那次看診量的比）。stay 是伺服器的 { admitWeightKg, weights: [{ at, kg }], temperatures: [{ at, c }] }。
export function stayRows(stay) {
  const slots = new Map();
  const slot = (at) => {
    const key = new Date(at).getTime();
    if (!slots.has(key)) slots.set(key, { key, at, kg: null, c: null });
    return slots.get(key);
  };
  for (const item of stay?.weights ?? []) slot(item.at).kg = item.kg;
  for (const item of stay?.temperatures ?? []) slot(item.at).c = item.c;
  let previous = stay?.admitWeightKg ?? null;
  let lastDate = '';
  return [...slots.values()]
    .sort((a, b) => a.key - b.key)
    .map((row) => {
      const date = clinicDateInput(row.at);
      const delta = row.kg !== null && previous !== null ? deltaLabel(previous, row.kg) : '';
      if (row.kg !== null) previous = row.kg;
      const dayStart = date !== lastDate;
      lastDate = date;
      return { key: row.key, label: dayStart ? shortDate(date) : '', dayStart, time: clinicTimeInput(row.at), kg: row.kg, delta, c: row.c };
    });
}

// 側欄的體重：入院看診量的那次，加上住院期間每一格有量的，舊到新；每一列帶跟上一次的差。
export function weightTrend(admitWeightKg, entries) {
  const rows = [];
  if (admitWeightKg !== null && admitWeightKg !== undefined) rows.push({ key: 'admit', label: '入院', kg: Number(admitWeightKg) });
  const weighed = (entries ?? [])
    .filter((entry) => entry.weightKg !== null && entry.weightKg !== undefined)
    .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt) || String(a._id).localeCompare(String(b._id)));
  for (const entry of weighed) rows.push({ key: String(entry._id), label: shortDateTime(entry.recordedAt), kg: Number(entry.weightKg) });
  return rows.map((row, index) => {
    if (index === 0) return { ...row, delta: '' };
    return { ...row, delta: deltaLabel(rows[index - 1].kg, row.kg) };
  });
}

// 取消住院只在還沒記任何照護紀錄時可以：從看診搬來的那一格用藥不算（伺服器同一個判準）。
export function canCancelHospitalization(detail) {
  if (detail?.status !== 'admitted') return false;
  return !(detail.entries ?? []).some((entry) => !entry.fromVisit);
}

// 住院幾天（入院那天是第 1 天，照日曆算）。
export function stayDays(admittedAt, endAt = new Date()) {
  const from = clinicDateInput(admittedAt);
  const to = clinicDateInput(endAt);
  if (!from || !to) return null;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
}

// 「10/13 15:40」。
export function shortDateTime(value) {
  return value ? `${shortDate(value)} ${clinicTimeInput(value)}` : '';
}
