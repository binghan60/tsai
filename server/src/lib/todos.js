import Todo from '../models/Todo.js';
import { emitTodosUpdate } from './realtime.js';

export const MAX_OPEN_TODOS = 200;
export const MAX_DONE_TODOS = 50;

// 有期限的排前面（越早越前），沒期限的照建立順序接在後面。
// 未完成清單上限 200 筆、在記憶體裡排，跟資料庫的 32MB 排序上限無關。
export function sortOpenTodos(rows) {
  return [...rows].sort((a, b) => {
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    if (Boolean(a.dueDate) !== Boolean(b.dueDate)) return a.dueDate ? -1 : 1;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
}

// 未完成 + 最近完成的一段，單一清單回給前端，前端依 status 分兩個頁籤。
// 待辦筆數很少，任何異動後一律整份重讀並廣播、前端直接取代，不處理差異合併。
export async function listTodos() {
  const [open, done] = await Promise.all([
    Todo.find({ status: 'open' }).sort({ createdAt: 1 }).limit(MAX_OPEN_TODOS).lean(),
    Todo.find({ status: 'done' }).sort({ doneAt: -1, _id: -1 }).limit(MAX_DONE_TODOS).lean(),
  ]);
  return [...sortOpenTodos(open), ...done];
}

// 重讀清單、廣播給所有裝置，並把同一份清單回給呼叫端當 HTTP 回應。
export async function publishTodos() {
  const items = await listTodos();
  emitTodosUpdate(items);
  return items;
}

// 只認真實存在的日曆日：2026-02-31 過得了 regex，但不是一天。
export function isValidDateInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
