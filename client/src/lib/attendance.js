import { clinicDateInput } from './datetime.js';

// 出席紀錄（遲到與未到）的顯示規則。數字來自 GET /api/pets/:id/attendance 的 counts，
// 是從掛號即時算的，跟「出席紀錄」頁籤的清單同一個口徑。

export function attendanceTotal(counts) {
  return (counts?.lateCount ?? 0) + (counts?.noShowCount ?? 0);
}

// 徽章上的「最近 9/28」：今年的只寫月日，跨年才帶年份。
export function shortDateLabel(date, today = clinicDateInput()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ''));
  if (!match) return '';
  const [, year, month, day] = match;
  const monthDay = `${Number(month)}/${Number(day)}`;
  return year === String(today).slice(0, 4) ? monthDay : `${year}/${monthDay}`;
}

// 要畫哪幾顆徽章：次數是 0 的不出現（欄位沒有值就留白）。
export function attendanceBadges(counts, today = clinicDateInput()) {
  const badges = [];
  if (counts?.lateCount > 0) {
    badges.push({ kind: 'late', label: '遲到', count: counts.lateCount, last: shortDateLabel(counts.lastLateDate, today) });
  }
  if (counts?.noShowCount > 0) {
    badges.push({ kind: 'no_show', label: '未到', count: counts.noShowCount, last: shortDateLabel(counts.lastNoShowDate, today) });
  }
  return badges;
}
