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
  let years = today.year - birth.year;
  let months = today.month - birth.month;
  if (today.day < birth.day) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return years > 0 ? `${years} 歲 ${months} 個月` : `${Math.max(months, 0)} 個月`;
}
