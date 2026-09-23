import Appointment from '../models/Appointment.js';
import MedicationOrder from '../models/MedicationOrder.js';
import { appointmentJournalContent, appointmentJournalFields, appointmentJournalSections } from './appointmentWorkflow.js';
import { medicationJournalContent, medicationJournalFields, medicationJournalSections, medicationJournalStage, medicationJournalTitle } from './medicationWorkflow.js';

// 日誌只保存掛號／藥單關聯；每次讀取都以來源文件的最新欄位組成內容。
// content 是串好的純文字（差異比對、長度判斷、找不到來源時的後備）；
// title／sections 是同一份內容的分欄版本，前端靠它分段顯示，不必再把字串拆回欄位。
// 手動與舊系統匯入的日誌本來就是自由文字，沒有 sections。
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
      // fields 是編輯表單用的原始值；改完透過 PUT /clinical-notes/:id 的 body.fields 寫回掛號。
      return {
        ...note,
        content: appointment ? appointmentJournalContent(appointment) : (note.content || '找不到對應的就診資料'),
        ...(appointment && { sections: appointmentJournalSections(appointment), fields: appointmentJournalFields(appointment) }),
        editableContent: appointment?.visitNote ?? note.content ?? '',
        readOnly: !appointment,
      };
    }
    if (note.medicationOrderId) {
      const order = orderById.get(String(note.medicationOrderId));
      // 病況、藥單、備註可從日誌更正（寫回藥單並留 history）；medicationStatus 讓前端提示「改了會退回待醫師確認」。
      return {
        ...note,
        content: order ? medicationJournalContent(order) : (note.content || '找不到對應的藥單資料'),
        ...(order && {
          title: medicationJournalTitle(order),
          stage: medicationJournalStage(order),
          sections: medicationJournalSections(order),
          fields: medicationJournalFields(order),
          medicationStatus: order.status,
        }),
        editableContent: '',
        readOnly: !order,
      };
    }
    return note;
  });
}
