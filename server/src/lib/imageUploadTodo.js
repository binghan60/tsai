import Todo from '../models/Todo.js';
import Appointment from '../models/Appointment.js';
import { emitAppointmentUpdate } from './realtime.js';
import { mentionSnapshots } from './petMentions.js';
import { escapeRichText } from '../../../shared/richText.js';

export const IMAGE_UPLOAD_LABEL = '上傳影像';

// 待辦內文：「上傳影像 #貓咪名」，貓咪用 # 標記（跟手動打的待辦同一套，點得進病歷速覽）。
// 貓咪名是資料，不是格式標記，先跳脫。
export function imageUploadTodoContent(petName) {
  const name = String(petName ?? '').trim();
  return name ? `${IMAGE_UPLOAD_LABEL} #${escapeRichText(name)}` : IMAGE_UPLOAD_LABEL;
}

// 櫃台處理視窗的「上傳影像」勾選框變動時呼叫（勾起來或取消，值沒變不要呼叫）：
// 勾了＝新增一筆院內待辦，id 記在掛號的 imageUploadTodoId；取消勾選＝把那筆還沒完成的待辦收掉
// （已經完成的留著，那是做過的事）。原本那筆還沒完成時重複勾不會多出第二筆。
// 回傳待辦清單有沒有變，呼叫端 transaction 結束後才廣播。
export async function syncImageUploadTodo(appointment, createdBy, { session } = {}) {
  const linked = appointment.imageUploadTodoId;
  if (!appointment.imageUpload) {
    if (!linked) return false;
    const { deletedCount } = await Todo.deleteOne({ _id: linked, status: 'open' }).session(session ?? null);
    appointment.imageUploadTodoId = null;
    appointment.imageUploadDoneAt = null;
    return deletedCount > 0;
  }
  if (linked && await Todo.exists({ _id: linked, status: 'open' }).session(session ?? null)) return false;
  const mentions = (appointment.petId ? await mentionSnapshots([String(appointment.petId)]) : null) ?? [];
  const [todo] = await Todo.create([{
    content: imageUploadTodoContent(mentions[0]?.petName ?? appointment.petName),
    createdBy,
    mentions,
  }], { session });
  appointment.imageUploadTodoId = todo._id;
  appointment.imageUploadDoneAt = null;
  return true;
}

// 看診離開流程（取消掛號、取消報到）：這次看診沒有成立，還沒做的那筆「上傳影像」待辦一併收掉——跟診療台開的藥單同一個道理。
// 已經完成的留著（那是做過的事）。勾選本身（imageUpload）不動：之後重新報到時 restoreImageUploadTodo 會把待辦補回來。
// 回傳待辦清單有沒有變。
export async function withdrawImageUploadTodo(appointment, { session } = {}) {
  if (!appointment.imageUploadTodoId) return false;
  const { deletedCount } = await Todo.deleteOne({ _id: appointment.imageUploadTodoId, status: 'open' }).session(session ?? null);
  if (!deletedCount) return false;
  appointment.imageUploadTodoId = null;
  return true;
}

// 重新報到：勾著「上傳影像」而待辦在取消時被收掉了，補一筆回來。
export async function restoreImageUploadTodo(appointment, { session } = {}) {
  if (appointment.imageUpload !== true || appointment.imageUploadTodoId) return false;
  return syncImageUploadTodo(appointment, 'front_desk', { session });
}

// 待辦被完成（doneAt 有值）或改回未完成（null）時呼叫：如果它是某次看診「上傳影像」帶出來的那一筆，
// 把完成時間寫回掛號，病歷日誌那一列跟著變成「已完成」加時間。不動 __v——這不是誰在編輯這筆掛號。
export async function recordImageUploadTodoDone(todoId, doneAt) {
  const appointment = await Appointment.findOneAndUpdate(
    { imageUploadTodoId: todoId, imageUpload: true },
    { $set: { imageUploadDoneAt: doneAt } },
    { new: true },
  );
  if (appointment) emitAppointmentUpdate(appointment);
}
