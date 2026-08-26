// 診所所在時區。使用者在畫面上挑的「某一天」指的一定是診所的那一天，
// 但伺服器跑在哪個時區是部署環境決定的（正式環境通常是 UTC）。
// 直接 new Date('2026-08-20') 會得到 UTC 午夜、new Date('2026-08-20T00:00:00')
// 會得到伺服器本地午夜 —— 兩者都不是台北午夜，日期篩選就會整段偏移。
export const CLINIC_TIMEZONE = 'Asia/Taipei';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

// 某個時刻在指定時區的 UTC 偏移量（毫秒）。
// 做法是把這個時刻「當成該時區的牆上時間」格式化出來，再當成 UTC 讀回去，
// 兩者的差就是偏移量。這樣不必自己維護任何時區表。
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
  // hour12:false 在部分執行環境會把午夜格式化成 24，取餘數歸回 0。
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

// 把使用者選的 YYYY-MM-DD 換算成「診所時區當天 00:00」對應的實際時刻。
// dayOffset 用來取隔天的開頭（區間查詢的上界要含當天整天）；
// Date.UTC 會自行處理跨月與跨年的進位。
// 台北沒有日光節約時間，所以不必處理「當地午夜不存在或出現兩次」的情況。
export function clinicDayStart(dateInput, dayOffset = 0) {
  const match = DATE_ONLY.exec(String(dateInput ?? '').trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const utcMidnight = Date.UTC(Number(year), Number(month) - 1, Number(day) + dayOffset);
  const instant = new Date(utcMidnight - zoneOffsetMs(new Date(utcMidnight), CLINIC_TIMEZONE));
  return Number.isNaN(instant.getTime()) ? null : instant;
}

const TIME_ONLY = /^(\d{2}):(\d{2})$/;

// 把使用者選的日期＋時間換算成診所時區對應的實際時刻，供預約排序/查詢使用。
// 台北沒有日光節約時間，同一天內加分鐘數不會跨過偏移量變化，直接在
// clinicDayStart 算出的午夜上加分鐘即可。
export function combineClinicDateTime(dateInput, timeInput) {
  const dayStart = clinicDayStart(dateInput);
  if (!dayStart) return null;
  const match = TIME_ONLY.exec(String(timeInput ?? '').trim());
  const minutes = match ? Number(match[1]) * 60 + Number(match[2]) : 0;
  return new Date(dayStart.getTime() + minutes * 60_000);
}

// 診所時區「今天」的 YYYY-MM-DD，給預約清單的預設日期與儀錶板的今日統計共用。
export function clinicToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_TIMEZONE }).format(now);
}
