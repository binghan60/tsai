import { normalizeRichText, richTextLength } from '../../../shared/richText.js';
import { clinicDayStart, clinicToday } from './clinicTime.js';

// 住院的純邏輯：住院第幾天、住院期間的每一天、病歷日誌那一列的文字、照護紀錄欄位的整理。
// 讀寫資料庫在 routes/hospitalizations.js。

const DAY_MS = 24 * 60 * 60 * 1000;

function dayIndex(date) {
  const start = clinicDayStart(date);
  return start ? Math.round(start.getTime() / DAY_MS) : null;
}

// 住院第幾天：入院那天是第 1 天（照日曆算，不照滿 24 小時算）。
export function hospitalDayNumber(admitDate, date) {
  const from = dayIndex(admitDate);
  const to = dayIndex(date);
  if (from === null || to === null) return null;
  return to - from + 1;
}

// 住院期間的每一天（YYYY-MM-DD，舊到新）：入院那天到出院那天；還在住院就到今天。
export function hospitalizationDates(admittedAt, endAt) {
  const first = clinicToday(new Date(admittedAt));
  const last = clinicToday(new Date(endAt));
  const dates = [];
  for (let offset = 0; offset < 400; offset += 1) {
    const date = clinicToday(clinicDayStart(first, offset));
    if (date > last) break;
    dates.push(date);
  }
  return dates;
}

// 「10/13」；不是今年寫「2025/10/13」（跟前端 lib/datetime.js 的 shortDate 一樣）。
export function shortClinicDate(date, reference = new Date()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ''));
  if (!match) return '';
  const label = `${Number(match[2])}/${Number(match[3])}`;
  return match[1] === clinicToday(reference).slice(0, 4) ? label : `${match[1]}/${label}`;
}

// 入院那次看診的病歷日誌上「住院」那一列：住院中寫「10/13 起住院中　第 3 天」，出院了寫「10/13–10/18　6 天」。
export function hospitalizationSpanText(hospitalization, now = new Date()) {
  const admitDate = clinicToday(new Date(hospitalization.admittedAt));
  if (hospitalization.status === 'discharged' && hospitalization.dischargedAt) {
    const dischargeDate = clinicToday(new Date(hospitalization.dischargedAt));
    return `${shortClinicDate(admitDate, now)}–${shortClinicDate(dischargeDate, now)}　${hospitalDayNumber(admitDate, dischargeDate)} 天`;
  }
  return `${shortClinicDate(admitDate, now)} 起住院中　第 ${hospitalDayNumber(admitDate, clinicToday(now))} 天`;
}

// 檢驗時間落在這次住院期間（入院之後、出院之前；還沒出院就是之後都算）。
export function coversTime(hospitalization, at) {
  if (!hospitalization || hospitalization.status === 'cancelled') return false;
  const time = new Date(at).getTime();
  if (Number.isNaN(time) || time < new Date(hospitalization.admittedAt).getTime()) return false;
  return !hospitalization.dischargedAt || time <= new Date(hospitalization.dischargedAt).getTime();
}

const TEXT_LIMITS = { food: 200, forceFeeding: 200, other: 2000 };
const STAFF = ['vet', 'front_desk'];

function invalid(message) {
  return Object.assign(new Error(message), { status: 422 });
}

// 照護紀錄送來的欄位整理成要存的值：沒帶的不動（回傳的物件裡沒有那個 key）。
// 用藥跟藥單同一種格式標記，存之前 normalizeRichText，字數看純文字；體溫空白＝沒量。
export function cleanEntryFields(body = {}) {
  const fields = {};
  for (const [key, limit] of Object.entries(TEXT_LIMITS)) {
    if (body[key] === undefined) continue;
    const value = String(body[key] ?? '').trim();
    if (value.length > limit) throw invalid(`內容太長（最多 ${limit} 字）`);
    fields[key] = value;
  }
  if (body.medication !== undefined) {
    const value = normalizeRichText(String(body.medication ?? '')).trim();
    if (richTextLength(value) > 2000) throw invalid('用藥內容太長（最多 2000 字）');
    fields.medication = value;
  }
  if (body.temperatureC !== undefined) {
    const raw = body.temperatureC;
    const value = raw === '' || raw === null ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value <= 0 || value > 50)) throw invalid('體溫格式不正確');
    fields.temperatureC = value;
  }
  if (body.weightKg !== undefined) fields.weightKg = cleanWeight(body.weightKg);
  if (body.recordedAt !== undefined) {
    const at = new Date(body.recordedAt);
    if (Number.isNaN(at.getTime())) throw invalid('時間格式不正確');
    fields.recordedAt = at;
  }
  if (body.staff !== undefined) fields.staff = STAFF.includes(body.staff) ? body.staff : '';
  return fields;
}

// 體重：空白＝沒量。
export function cleanWeight(raw) {
  const value = raw === '' || raw === null || raw === undefined ? null : Number(raw);
  if (value !== null && (!Number.isFinite(value) || value <= 0 || value > 50)) throw invalid('體重格式不正確');
  return value;
}
