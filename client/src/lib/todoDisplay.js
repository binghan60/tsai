// 待辦期限的顯示規則。tone 對應狀態語意 token：逾期＝danger、今天＝warning，之後的日期＝info（不用灰色，灰色看起來像沒有狀態）。
// 日期一律當 YYYY-MM-DD 純日曆值處理（全程只用 Date.UTC 做整數日相減），不經過本地時區。
import { richTextToPlain } from '../../../shared/richText.js';
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function toDayNumber(value) {
  const match = DATE_ONLY.exec(String(value ?? ''));
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000;
}

export const DUE_TONE_CLASS = {
  danger: 'bg-danger-surface text-danger',
  warning: 'bg-warning-surface text-warning',
  info: 'bg-info-surface text-info',
};

// 待辦的顏色標記（Todo.color）：名稱同 shared/todoColors.js；前四色對應狀態語意 token，紫用 mark-purple（不佔手術專用的 surgery）、青用 primary／accent，文字顏色同一組。
// class 全部寫成完整字串，Tailwind 才掃得到。row＝整列底色、dot＝總覽的色點、swatch＝選單裡的實心色塊（邊框同色）。
export const TODO_COLORS = [
  { key: 'red', label: '紅色', row: 'bg-danger-surface', dot: 'fill-danger text-danger', swatch: 'bg-danger border-danger' },
  { key: 'orange', label: '橙色', row: 'bg-warning-surface', dot: 'fill-warning text-warning', swatch: 'bg-warning border-warning' },
  { key: 'green', label: '綠色', row: 'bg-success-surface', dot: 'fill-success text-success', swatch: 'bg-success border-success' },
  { key: 'blue', label: '藍色', row: 'bg-info-surface', dot: 'fill-info text-info', swatch: 'bg-info border-info' },
  { key: 'purple', label: '紫色', row: 'bg-mark-purple-surface', dot: 'fill-mark-purple text-mark-purple', swatch: 'bg-mark-purple border-mark-purple' },
  { key: 'teal', label: '青色', row: 'bg-accent', dot: 'fill-primary text-primary', swatch: 'bg-primary border-primary' },
];

export const todoColor = (key) => TODO_COLORS.find((color) => color.key === key) ?? null;

// 沒有期限、或日期讀不懂時回 null，畫面就不出徽章。
export function dueStatus(dueDate, today) {
  const due = toDayNumber(dueDate);
  const now = toDayNumber(today);
  if (due === null || now === null) return null;
  const days = due - now;
  if (days < 0) return { tone: 'danger', label: `逾期 ${-days} 天`, overdue: true };
  if (days === 0) return { tone: 'warning', label: '今天', overdue: false };
  if (days === 1) return { tone: 'info', label: '明天', overdue: false };
  const [, , month, day] = DATE_ONLY.exec(dueDate);
  return { tone: 'info', label: `${Number(month)}/${Number(day)}`, overdue: false };
}


// 待辦搜尋（未完成的在前端比對；已完成的由伺服器 /todos/search 查全部歷史，比對同樣三個地方）：
// 內文（去掉粗體／顏色標記）、處理過程、# 標記的貓咪名字。不分大小寫，關鍵字當字面字串。
export function todoMatches(item, keyword) {
  const needle = String(keyword ?? '').trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    richTextToPlain(item?.content ?? ''),
    item?.progress ?? '',
    ...(item?.mentions ?? []).map((mention) => mention.petName ?? ''),
  ].join('\n').toLowerCase();
  return haystack.includes(needle);
}
