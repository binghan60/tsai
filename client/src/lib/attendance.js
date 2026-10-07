// 出席紀錄（遲到與未到）的顯示規則。數字來自 GET /api/pets/:id/attendance 的 counts，
// 是從掛號即時算的，跟「出席紀錄」頁籤的清單同一個口徑。

export function attendanceTotal(counts) {
  return (counts?.lateCount ?? 0) + (counts?.noShowCount ?? 0);
}

// 「最近一次」的日期：一律帶年份（2026/9/28）。曾經今年的只寫月日，使用者要求顯示到年份。
export function attendanceDateLabel(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ''));
  if (!match) return '';
  const [, year, month, day] = match;
  return `${year}/${Number(month)}/${Number(day)}`;
}

// 掛號視窗的對照表：一列一個對象（貓咪、飼主名下），沒有紀錄的對象不列。
// 「最近一次」不分遲到或未到，取較晚的那一天。
export function attendanceRows(entries) {
  return entries
    .filter((entry) => attendanceTotal(entry.counts) > 0)
    .map(({ label, counts }) => {
      const last = [counts.lastLateDate, counts.lastNoShowDate].filter(Boolean).sort().at(-1);
      return { label, late: counts.lateCount ?? 0, noShow: counts.noShowCount ?? 0, last: attendanceDateLabel(last) };
    });
}

// 要畫哪幾顆徽章：次數是 0 的不出現（欄位沒有值就留白）。
export function attendanceBadges(counts) {
  const badges = [];
  if (counts?.lateCount > 0) {
    badges.push({ kind: 'late', label: '遲到', count: counts.lateCount, last: attendanceDateLabel(counts.lastLateDate) });
  }
  if (counts?.noShowCount > 0) {
    badges.push({ kind: 'no_show', label: '未到', count: counts.noShowCount, last: attendanceDateLabel(counts.lastNoShowDate) });
  }
  return badges;
}
