import Appointment from '../models/Appointment.js';
import { appointmentJournalContent } from './appointmentWorkflow.js';

// 日誌只保存掛號關聯；每次讀取都以掛號的最新欄位組成內容。
export async function clinicalNoteViews(notes) {
  const items = notes.map(note => note.toObject ? note.toObject() : { ...note });
  const ids = items.filter(note => note.appointmentId).map(note => note.appointmentId);
  if (!ids.length) return items;
  const appointments = await Appointment.find({ _id: { $in: ids } }).lean();
  const byId = new Map(appointments.map(item => [String(item._id), item]));
  return items.map(note => {
    if (!note.appointmentId) return note;
    const appointment = byId.get(String(note.appointmentId));
    return {
      ...note,
      content: appointment ? appointmentJournalContent(appointment) : (note.content || '找不到對應的就診資料'),
      editableContent: appointment?.visitNote ?? note.content ?? '',
      readOnly: false,
    };
  });
}
