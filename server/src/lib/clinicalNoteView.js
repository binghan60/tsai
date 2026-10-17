import Appointment from '../models/Appointment.js';
import MedicationOrder from '../models/MedicationOrder.js';
import MedicalRecord from '../models/MedicalRecord.js';
import Hospitalization from '../models/Hospitalization.js';
import HospitalizationEntry from '../models/HospitalizationEntry.js';
import LabResult from '../models/LabResult.js';
import { hospitalizationSpanText, stayJournalSummary } from './hospitalization.js';
import { appointmentJournalContent, appointmentJournalFields, appointmentJournalSections, labTimeLabel } from './appointmentWorkflow.js';
import { linkedLabResults } from './appointmentJournal.js';
import { medicationJournalContent, medicationJournalFields, medicationJournalSections, medicationJournalStage, medicationJournalTitle } from './medicationWorkflow.js';

// 看診日誌的「藥單」列帶上連著那張藥單的階段（stage 文字、medicationStatus、needsRepack）；沒有藥單（還沒送交、已取消）就不帶。
function withMedicationStage(sections, order) {
  if (!order || order.status === 'cancelled') return sections;
  return sections.map(section => (section.key === 'prescription'
    ? { ...section, stage: medicationJournalStage(order), medicationStatus: order.status, needsRepack: Boolean(order.needsRepack) }
    : section));
}

// 看診日誌的「健檢報告」列：這次看診的報告（含修訂版）寄出過就記「已寄出　時間」；沒寄過不列。
// 寄送狀態由報告即時推導，不另存在掛號上，所以櫃台不必再手動勾。
function withReportDelivery(sections, sentAt) {
  if (!sentAt) return sections;
  const row = { key: 'reportDelivery', label: '健檢報告', text: `已寄出　${labTimeLabel(sentAt)}` };
  const at = sections.findIndex(section => section.key === 'deskItems');
  return at < 0 ? [...sections, row] : [...sections.slice(0, at + 1), row, ...sections.slice(at + 1)];
}

// 入院那次看診的日誌最後一列「住院」：住院中寫「10/13 起住院中　第 3 天」，出院了寫期間與天數；點了到住院專區。
// 出院之後多帶 stay：住院期間每一格量的體重、體溫與連到這次住院的 IDEXX 結果（即時引用，其餘照護紀錄仍只在住院專區看）。
// 取消的住院不列。唯讀，不能從日誌改。
function withHospitalization(sections, hospitalization, summary) {
  if (!hospitalization || hospitalization.status === 'cancelled') return sections;
  const hasSummary = hospitalization.status === 'discharged' && summary && (summary.weights.length || summary.temperatures.length || summary.results.length);
  return [...sections, { key: 'hospitalization', label: '住院', text: hospitalizationSpanText(hospitalization), hospitalizationId: String(hospitalization._id), status: hospitalization.status, ...(hasSummary ? { stay: summary } : {}) }];
}

// 日誌只保存掛號／藥單關聯；每次讀取都以來源文件的最新欄位組成內容。
// content 是串好的純文字（差異比對、長度判斷、找不到來源時的後備）；
// title／sections 是同一份內容的分欄版本，前端靠它分段顯示，不必再把字串拆回欄位。
// 手動與舊系統匯入的日誌本來就是自由文字，沒有 sections。
export async function clinicalNoteViews(notes) {
  const items = notes.map(note => note.toObject ? note.toObject() : { ...note });
  const appointmentIds = items.filter(note => note.appointmentId).map(note => note.appointmentId);
  const orderIds = items.filter(note => note.medicationOrderId).map(note => note.medicationOrderId);
  if (!appointmentIds.length && !orderIds.length) return items;

  const [appointments, labsByAppointment, orders] = await Promise.all([
    appointmentIds.length ? Appointment.find({ _id: { $in: appointmentIds } }).lean() : [],
    linkedLabResults(appointmentIds),
    // history 只是異動軌跡，日誌內文用不到，不必整包撈回來。
    orderIds.length ? MedicationOrder.find({ _id: { $in: orderIds } }).select('-history').lean() : [],
  ]);
  const appointmentById = new Map(appointments.map(item => [String(item._id), item]));
  // 看診日誌的「藥單」列要標出連著那張藥單走到哪（待包藥、待領藥、已領藥…），所以把診療台開的藥單也撈回來。
  const visitOrderIds = appointments.map(item => item.medicationOrderId).filter(Boolean);
  const visitOrders = visitOrderIds.length ? await MedicationOrder.find({ _id: { $in: visitOrderIds } }).select('-history').lean() : [];
  const orderById = new Map([...orders, ...visitOrders].map(item => [String(item._id), item]));

  // 掛號的 recordId 是報告根；修訂版沿 revisionRootId 找回來。同一次看診任何一版寄出過就算已寄出，取最近一次。
  const rootIds = appointments.map(item => item.recordId).filter(Boolean);
  const sentRecords = rootIds.length
    ? await MedicalRecord.find({ deliveryStatus: 'sent', $or: [{ _id: { $in: rootIds } }, { revisionRootId: { $in: rootIds } }] }).select('revisionRootId sentAt').lean()
    : [];
  const stayIds = appointments.map(item => item.hospitalizationId).filter(Boolean);
  const stays = stayIds.length ? await Hospitalization.find({ _id: { $in: stayIds } }).select('status admittedAt dischargedAt').lean() : [];
  const stayById = new Map(stays.map(item => [String(item._id), item]));
  // 已出院的住院才帶摘要：體重、體溫（照護紀錄上有量的）與連到住院單的檢驗結果。
  const dischargedIds = stays.filter(item => item.status === 'discharged').map(item => item._id);
  const [stayEntries, stayLabs] = dischargedIds.length
    ? await Promise.all([
      HospitalizationEntry.find({ hospitalizationId: { $in: dischargedIds }, $or: [{ weightKg: { $ne: null } }, { temperatureC: { $ne: null } }] })
        .select('hospitalizationId recordedAt weightKg temperatureC').sort({ recordedAt: 1, _id: 1 }).lean(),
      LabResult.find({ hospitalizationId: { $in: dischargedIds } })
        .select('hospitalizationId instrument runAt assays overrides notes').sort({ runAt: 1, _id: 1 }).lean(),
    ])
    : [[], []];
  const stayOf = (list, id) => list.filter(item => String(item.hospitalizationId) === String(id));
  const sentAtByRoot = new Map();
  for (const record of sentRecords) {
    const root = String(record.revisionRootId || record._id);
    const at = record.sentAt ? new Date(record.sentAt) : null;
    const prev = sentAtByRoot.get(root);
    if (!prev || (at && at > prev)) sentAtByRoot.set(root, at || prev || new Date(0));
  }

  return items.map(note => {
    if (note.appointmentId) {
      const appointment = appointmentById.get(String(note.appointmentId));
      const labs = labsByAppointment.get(String(note.appointmentId)) ?? [];
      // fields 是編輯表單用的原始值；改完透過 PUT /clinical-notes/:id 的 body.fields 寫回掛號。
      return {
        ...note,
        content: appointment ? appointmentJournalContent(appointment, labs) : (note.content || '找不到對應的就診資料'),
        ...(appointment && {
          sections: withHospitalization(
            withReportDelivery(withMedicationStage(appointmentJournalSections(appointment, labs), orderById.get(String(appointment.medicationOrderId))), appointment.recordId && sentAtByRoot.get(String(appointment.recordId))),
            appointment.hospitalizationId && stayById.get(String(appointment.hospitalizationId)),
            appointment.hospitalizationId && stayJournalSummary(stayOf(stayEntries, appointment.hospitalizationId), stayOf(stayLabs, appointment.hospitalizationId), appointment.weightKg),
          ),
          fields: appointmentJournalFields(appointment),
        }),
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
