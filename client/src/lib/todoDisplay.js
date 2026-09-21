// 待辦期限的顯示規則。tone 對應狀態語意 token：逾期＝danger、今天＝warning，其餘中性。
// 日期一律當 YYYY-MM-DD 純日曆值處理（全程只用 Date.UTC 做整數日相減），不經過本地時區。
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function toDayNumber(value) {
  const match = DATE_ONLY.exec(String(value ?? ''));
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000;
}

export const DUE_TONE_CLASS = {
  danger: 'bg-danger-surface text-danger',
  warning: 'bg-warning-surface text-warning',
  neutral: 'bg-muted text-muted-foreground',
};

// 沒有期限、或日期讀不懂時回 null，畫面就不出徽章。
export function dueStatus(dueDate, today) {
  const due = toDayNumber(dueDate);
  const now = toDayNumber(today);
  if (due === null || now === null) return null;
  const days = due - now;
  if (days < 0) return { tone: 'danger', label: `逾期 ${-days} 天`, overdue: true };
  if (days === 0) return { tone: 'warning', label: '今天', overdue: false };
  if (days === 1) return { tone: 'neutral', label: '明天', overdue: false };
  const [, , month, day] = DATE_ONLY.exec(dueDate);
  return { tone: 'neutral', label: `${Number(month)}/${Number(day)}`, overdue: false };
}

// 面板標題旁的說明：有幾筆逾期比總數更該被看見。
export function overdueCount(items, today) {
  return items.filter((item) => item.status === 'open' && dueStatus(item.dueDate, today)?.overdue).length;
}
