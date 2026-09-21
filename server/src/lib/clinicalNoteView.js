import Appointment from '../models/Appointment.js';
import MedicationOrder from '../models/MedicationOrder.js';
import { appointmentJournalContent } from './appointmentWorkflow.js';
import { medicationJournalContent } from './medicationWorkflow.js';

// 日誌只保存掛號／藥單關聯；每次讀取都以來源文件的最新欄位組成內容。
export async function clinicalNoteViews(notes) {
  const items = notes.map(note => note.toObject ? note.toObject() : { ...note });
  const appointmentIds = items.filter(note => note.appointmentId).map(note => note.appointmentId);
  const orderIds = items.filter(note => note.medicationOrderId).map(note => note.medicationOrderId);
  if (!appointmentIds.length && !orderIds.length) return items;

  const [appointments, orders] = await Promise.all([
    appointmentIds.length ? Appointment.find({ _id: { $in: appointmentIds } }).lean() : [],
    // history 只是異動軌跡，日誌內文用不到，不必整包撈回來。
    orderIds.length ? MedicationOrder.find({ _id: { $in: orderIds } }).select('-history').lean() : [],
  ]);
  const appointmentById = new Map(appointments.map(item => [String(item._id), item]));
  const orderById = new Map(orders.map(item => [String(item._id), item]));

  return items.map(note => {
    if (note.appointmentId) {
      const appointment = appointmentById.get(String(note.appointmentId));
      return {
        ...note,
        content: appointment ? appointmentJournalContent(appointment) : (note.content || '找不到對應的就診資料'),
        editableContent: appointment?.visitNote ?? note.content ?? '',
        readOnly: false,
      };
    }
    if (note.medicationOrderId) {
      const order = orderById.get(String(note.medicationOrderId));
      // 藥單日誌沒有可就地編輯的自由文字：病況、藥單、備註都要回藥單改，改完日誌自然跟著變。
      return {
        ...note,
        content: order ? medicationJournalContent(order) : (note.content || '找不到對應的藥單資料'),
        editableContent: '',
        readOnly: true,
      };
    }
    return note;
  });
}
