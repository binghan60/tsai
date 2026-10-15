import { normalizeRichText, richTextToPlain } from '../../../shared/richText.js';
import { clinicDateInput, clinicTimeInput, combineClinicDateTime, shortDate } from './datetime.js';

// 住院專區的純邏輯：照護時間軸怎麼分天、每筆列哪幾欄、新增／修改表單送出什麼、體重變化。
// 規則見 CLAUDE.md 第三節 hospitalizations。

// 照護紀錄一筆可填的欄位：時間（HH:MM，送出時跟那一天組回 recordedAt）、食物放置、灌食、用藥、其他、體溫。
export const ENTRY_FIELDS = ['time', 'food', 'forceFeeding', 'medication', 'other', 'temperatureC'];

export const ENTRY_FIELD_LABELS = {
  time: '時間',
  food: '食物放置',
  forceFeeding: '灌食',
  medication: '用藥',
  other: '其他',
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
    temperatureC: entry?.temperatureC === null || entry?.temperatureC === undefined ? '' : String(entry.temperatureC),
  };
}

export function emptyEntryDraft(time = '') {
  return { time, food: '', forceFeeding: '', medication: '', other: '', temperatureC: '' };
}

// 跟伺服器存的樣子一樣整理過的值：伺服器會去掉頭尾空白、用藥會 normalizeRichText、體溫存成數字。
// 「有沒有改」一律比整理過的值，多打一個空白不算改過。
export function normalizedField(key, value) {
  const text = String(value ?? '');
  if (key === 'medication') return normalizeRichText(text).trim();
  if (key === 'temperatureC') {
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
    patch[key] = key === 'temperatureC' ? String(draft[key] ?? '').trim() : draft[key];
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
export function daySections(dates, entries, days) {
  const weights = new Map((days ?? []).map((day) => [day.date, day.weightKg ?? null]));
  return (dates ?? [])
    .map((date, index) => ({ date, dayNumber: index + 1, entries: entriesOnDate(entries, date), weightKg: weights.get(date) ?? null }))
    .reverse();
}

// 新增一筆的預設時間：記今天就是現在；補記過去的日子預設那天中午。
export function newEntryTime(date, now = new Date()) {
  return clinicDateInput(now) === date ? now : combineClinicDateTime(date, '12:00');
}

// 側欄的體重：入院看診量的那次，加上住院每天有填的，舊到新；每一列帶跟上一次的差。
export function weightTrend(admitWeightKg, dates, days) {
  const byDate = new Map((days ?? []).filter((day) => day.weightKg !== null && day.weightKg !== undefined).map((day) => [day.date, day.weightKg]));
  const rows = [];
  if (admitWeightKg !== null && admitWeightKg !== undefined) rows.push({ key: 'admit', label: '入院', kg: Number(admitWeightKg) });
  for (const date of dates ?? []) {
    if (byDate.has(date)) rows.push({ key: date, label: shortDate(date), kg: Number(byDate.get(date)) });
  }
  return rows.map((row, index) => {
    if (index === 0) return { ...row, delta: '' };
    const diff = Math.round((row.kg - rows[index - 1].kg) * 100) / 100;
    return { ...row, delta: diff === 0 ? '±0' : `${diff > 0 ? '+' : '−'}${Math.abs(diff)}` };
  });
}

// 取消住院只在還沒記任何紀錄時可以：從看診搬來的那一格用藥不算，體重有填才算（伺服器同一個判準）。
export function canCancelHospitalization(detail) {
  if (detail?.status !== 'admitted') return false;
  const entries = detail.entries ?? [];
  const days = detail.days ?? [];
  return !entries.some((entry) => !entry.fromVisit) && !days.some((day) => day.weightKg !== null && day.weightKg !== undefined);
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
