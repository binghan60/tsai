import ClinicalNote from '../models/ClinicalNote.js';
import LabResult from '../models/LabResult.js';
import { combineClinicDateTime } from './clinicTime.js';
import { appointmentJournalContent } from './appointmentWorkflow.js';

// 連到看診的 IDEXX 結果（當天自動歸過來的、診療台匯入時指定的），日誌的「IDEXX 檢驗」那一段用。
// 回傳 Map<appointmentId 字串, 結果陣列（依檢驗時間）>。
export async function linkedLabResults(appointmentIds, { session } = {}) {
  const byAppointment = new Map();
  if (!appointmentIds.length) return byAppointment;
  const results = await LabResult.find({ appointmentId: { $in: appointmentIds } })
    .select('appointmentId instrument runAt assays overrides notes filled').sort({ runAt: 1, _id: 1 }).session(session ?? null).lean();
  for (const result of results) {
    const key = String(result.appointmentId);
    if (!byAppointment.has(key)) byAppointment.set(key, []);
    byAppointment.get(key).push(result);
  }
  return byAppointment;
}

// 掛號日誌不存內容、讀取時由看診即時組出；這裡只確保「有內容就有一筆日誌、沒內容就沒有」。
// 看診的欄位從哪裡被改（診療台、健檢報告填寫頁），以及 IDEXX 結果連上／解除這次看診，都走這裡。
export async function syncAppointmentJournal(appointment, { session } = {}) {
  const labResults = (await linkedLabResults([appointment._id], { session })).get(String(appointment._id)) ?? [];
  if (appointment.petId && appointmentJournalContent(appointment, labResults)) {
    await ClinicalNote.findOneAndUpdate({ appointmentId: appointment._id }, { $set: {
      petId: appointment.petId,
      entryDate: combineClinicDateTime(appointment.date, '10:00'),
      source: 'appointment',
    }, $unset: { content: '' } }, { upsert: true, runValidators: true, session });
  } else {
    await ClinicalNote.deleteOne({ appointmentId: appointment._id }).session(session);
  }
}
