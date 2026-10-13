import Todo from '../models/Todo.js';
import Appointment from '../models/Appointment.js';
import Owner from '../models/Owner.js';
import { emitTodosUpdate } from './realtime.js';
import { withTransaction } from './transaction.js';
import { escapeRegExp } from './regex.js';
import { compareTodoOrder, moveBefore } from '../../../shared/todoOrder.js';

export const MAX_OPEN_TODOS = 200;
export const MAX_DONE_TODOS = 50;

// 完全照手動順序（拖拉排序）：期限、星號都不影響位置。
// 未完成清單上限 200 筆、在記憶體裡排，跟資料庫的 32MB 排序上限無關。
export function sortOpenTodos(rows) {
  return [...rows].sort(compareTodoOrder);
}

// 未完成的超過上限時留最新的那一批：剛新增的待辦一定看得到（留最舊的話，新增之後清單上會找不到它）。
function openTodosQuery() {
  return Todo.find({ status: 'open' }).sort({ createdAt: -1 }).limit(MAX_OPEN_TODOS);
}

// 未完成 + 最近完成的一段，單一清單回給前端，前端依 status 分兩個頁籤。
// 待辦筆數很少，任何異動後一律整份重讀並廣播、前端直接取代，不處理差異合併。
export async function listTodos() {
  const [open, done] = await Promise.all([
    openTodosQuery().lean(),
    Todo.find({ status: 'done' }).sort({ doneAt: -1, _id: -1 }).limit(MAX_DONE_TODOS).lean(),
  ]);
  return [...sortOpenTodos(await withOwnerEmails(open)), ...done];
}

// 掛號「上傳影像」帶出來的待辦要附飼主 Email（上傳影像時要寄給飼主）：即時由掛號查到飼主、
// 讀他現在的 Email，不在待辦上存快照——飼主改了信箱，待辦上的也跟著對。沒有連到掛號、飼主沒填
// Email 的待辦不帶 ownerEmail。只查未完成的：做完的不再需要。
async function withOwnerEmails(rows) {
  if (!rows.length) return rows;
  const appointments = await Appointment.find({ imageUploadTodoId: { $in: rows.map((row) => row._id) } })
    .select('imageUploadTodoId ownerId').lean();
  const ownerIds = [...new Set(appointments.filter((a) => a.ownerId).map((a) => String(a.ownerId)))];
  if (!ownerIds.length) return rows;
  const owners = await Owner.find({ _id: { $in: ownerIds } }).select('email').lean();
  const emailByOwner = new Map(owners.filter((o) => o.email).map((o) => [String(o._id), o.email]));
  const emailByTodo = new Map();
  for (const appointment of appointments) {
    const email = emailByOwner.get(String(appointment.ownerId));
    if (email) emailByTodo.set(String(appointment.imageUploadTodoId), email);
  }
  return rows.map((row) => (emailByTodo.has(String(row._id)) ? { ...row, ownerEmail: emailByTodo.get(String(row._id)) } : row));
}

// 搜尋已完成的待辦：不限最近 50 筆，翻得到全部歷史（「上次叫 k/d 是哪天」）。
// 比對內文、處理結果與 # 標記的貓咪名字；新到舊，最多 SEARCH_LIMIT 筆。未完成的在前端自己比對（整份都在 store 裡）。
export const SEARCH_LIMIT = 200;
export async function searchDoneTodos(keyword) {
  const pattern = new RegExp(escapeRegExp(keyword), 'i');
  return Todo.find({
    status: 'done',
    $or: [{ content: pattern }, { progress: pattern }, { 'mentions.petName': pattern }],
  }).sort({ doneAt: -1, _id: -1 }).limit(SEARCH_LIMIT).lean();
}

// 拖拉排序：把 id 移到 beforeId 前面（null＝最後），整份未完成清單依新順序編號 0、1、2…，
// 只寫有變的幾筆。id 已經不是未完成、或 beforeId 已經不在清單上（另一台剛完成或刪掉）回 false，
// 呼叫端回 409 讓前端重讀——照著過時的畫面硬排，會把別人剛排好的順序弄亂。
export async function moveTodo(id, beforeId) {
  return withTransaction(async (session) => {
    const open = sortOpenTodos(await openTodosQuery().select('_id sortOrder createdAt').session(session).lean());
    const ids = moveBefore(open.map((todo) => todo._id), id, beforeId);
    if (!ids) return false;
    const current = new Map(open.map((todo) => [String(todo._id), todo.sortOrder]));
    const operations = ids
      .map((todoId, index) => ({ todoId, index }))
      .filter(({ todoId, index }) => current.get(todoId) !== index)
      .map(({ todoId, index }) => ({ updateOne: { filter: { _id: todoId, status: 'open' }, update: { $set: { sortOrder: index } } } }));
    if (operations.length) await Todo.bulkWrite(operations, { session });
    return true;
  });
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
