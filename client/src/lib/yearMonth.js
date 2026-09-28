// 疫苗「最後注射時間」、「上次健檢時間」的年月文字：「2026 年 1 月」，月份不確定時只寫「2026 年」。
// 存成看得懂的文字，病歷、報告、診療台直接顯示，不必各自轉換（見 components/YearMonthSelect.vue）。

const PATTERN = /^(\d{4}) 年(?: (\d{1,2}) 月)?$/;

// 看不懂的文字（舊資料的「8/10」之類）回傳 null。
export function parseYearMonth(value) {
  const match = PATTERN.exec(String(value ?? '').trim());
  if (!match) return null;
  const month = match[2] ? Number(match[2]) : null;
  if (month !== null && (month < 1 || month > 12)) return null;
  return { year: match[1], month: month === null ? '' : String(month) };
}

export function composeYearMonth(year, month) {
  if (!year) return '';
  return month ? `${year} 年 ${Number(month)} 月` : `${year} 年`;
}
