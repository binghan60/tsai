// 報告的日期一律以診所所在時區呈現，不跟著瀏覽器／伺服器的本地時區跑。
// PDF 是後端 Puppeteer 以 Asia/Taipei 截圖產生的，畫面上看到的日期必須與 PDF 一致。
export const CLINIC_TIME_ZONE = 'Asia/Taipei';

function toValidDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// <input type="date"> 的值：診所時區下的 YYYY-MM-DD。
//
// 不要用 new Date().toISOString().slice(0, 10) —— 那是 UTC 的日期，
// 台灣時間半夜到早上八點之間開一份報告，健檢日期會預設成昨天。
// 讀回既有日期時同理：資料庫存的是 UTC 時間點，要換算回診所時區才是當初填的那一天。
// en-CA 的日期格式剛好就是 YYYY-MM-DD。
export function clinicDateInput(value = new Date()) {
  const date = toValidDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CLINIC_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_ONLY = /^(\d{2}):(\d{2})$/;

// 某個時刻在指定時區的 UTC 偏移量（毫秒）。做法跟後端 lib/clinicTime.js 的
// zoneOffsetMs 一樣：把這個時刻「當成該時區的牆上時間」格式化出來，再當成 UTC 讀回去，
// 兩者的差就是偏移量。前後端各自獨立一份，因為前端不能 import 後端程式碼。
function zoneOffsetMs(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const valueOf = (type) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    valueOf('year'),
    valueOf('month') - 1,
    valueOf('day'),
    valueOf('hour') % 24,
    valueOf('minute'),
    valueOf('second')
  );
  return asUtc - instant.getTime();
}

// 把使用者選的 YYYY-MM-DD ＋ HH:MM（時間選填）換算成診所時區對應的實際時刻。
// 用途：回診日期需要精確到分鐘，但 <input type="date"> 只給得出日期，時間另外用
// TimePicker 收。沒填時間就當作診所時區當天 00:00。
export function combineClinicDateTime(dateInput, timeInput) {
  const match = DATE_ONLY.exec(String(dateInput ?? '').trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const utcMidnight = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const dayStart = utcMidnight - zoneOffsetMs(new Date(utcMidnight), CLINIC_TIME_ZONE);
  const timeMatch = TIME_ONLY.exec(String(timeInput ?? '').trim());
  const minutes = timeMatch ? Number(timeMatch[1]) * 60 + Number(timeMatch[2]) : 0;
  const instant = new Date(dayStart + minutes * 60_000);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

// 從既有時刻取出診所時區下的 HH:MM，供 TimePicker 顯示既有的回診時間。
export function clinicTimeInput(value) {
  const date = toValidDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: CLINIC_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

// 在 YYYY-MM-DD 上加減天數，回傳同樣格式。
//
// 不要用 new Date(值) 再 setDate()：那會把字串當成 UTC 午夜、再用本地時區讀回來，
// 台灣是 UTC+8，換算後仍是同一天所以看起來沒事，但換個時區就會整個偏掉。
// 這裡全程只在 UTC 上做整數日的加減，跟時區完全無關——Date.UTC 也會自己處理跨月跨年。
export function shiftDateInput(value, days) {
  const match = DATE_ONLY.exec(String(value ?? '').trim());
  if (!match) return '';
  const [, year, month, day] = match;
  const shifted = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + days));
  return Number.isNaN(shifted.getTime()) ? '' : shifted.toISOString().slice(0, 10);
}

// 星期幾。診所看的是「這天有沒有診」，所以日期面板要把它標出來。
export function weekdayLabel(value, fallback = '') {
  const match = DATE_ONLY.exec(String(value ?? '').trim());
  if (!match) return fallback;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(date.getTime())) return fallback;
  // 用 UTC 讀回來，才會拿到當初傳進去的那一天。
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'UTC', weekday: 'short' }).format(date);
}

// 該週的週一（ISO 週制）。全程用 Date.UTC 整數天運算，避免時區問題。
// weekStartsOn: 1=週一（ISO），0=週日（美式）。
export function startOfWeek(value, weekStartsOn = 1) {
  const match = DATE_ONLY.exec(String(value ?? '').trim());
  if (!match) return '';
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(date.getTime())) return '';
  // UTC 下 getUTCDay() 在 0（週日）到 6（週六）。ISO 週一是 1，週日是 0；美式週日是 0，週一是 1。
  const utcDay = date.getUTCDay();
  const iso = weekStartsOn === 1 ? (utcDay === 0 ? 6 : utcDay - 1) : utcDay;
  const diff = iso;
  const monday = new Date(date.getTime() - diff * 24 * 60 * 60 * 1000);
  return monday.toISOString().slice(0, 10);
}

// 取出指定時區下的年／月／日，避免用 getFullYear() 這類隱含本地時區的方法。
function dateParts(date) {
  const [year, month, day] = clinicDateInput(date).split('-').map(Number);
  return { year, month, day };
}

export function formatDate(value, fallback = '—') {
  const date = toValidDate(value);
  return date ? date.toLocaleDateString('zh-TW', { timeZone: CLINIC_TIME_ZONE }) : fallback;
}

export function formatDateTime(value, options = { dateStyle: 'medium', timeStyle: 'short' }, fallback = '—') {
  const date = toValidDate(value);
  return date ? date.toLocaleString('zh-TW', { ...options, timeZone: CLINIC_TIME_ZONE }) : fallback;
}

export function ageLabel(birthDate, referenceDate = new Date(), fallback = '未記錄') {
  const birthValue = toValidDate(birthDate);
  const referenceValue = toValidDate(referenceDate) ?? new Date();
  if (!birthValue) return fallback;

  const birth = dateParts(birthValue);
  const today = dateParts(referenceValue);
  if (birth.year > today.year || (birth.year === today.year && (birth.month > today.month || (birth.month === today.month && birth.day > today.day)))) return fallback;
  let years = today.year - birth.year;
  let months = today.month - birth.month;
  if (today.day < birth.day) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return years > 0 ? `${years} 歲 ${months} 個月` : `${Math.max(months, 0)} 個月`;
}
