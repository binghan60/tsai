import ClinicalNote from '../models/ClinicalNote.js';
import { combineClinicDateTime } from './clinicTime.js';
import { appointmentJournalContent } from './appointmentWorkflow.js';

// 掛號日誌不存內容、讀取時由看診即時組出；這裡只確保「有內容就有一筆日誌、沒內容就沒有」。
// 看診的欄位從哪裡被改（診療台、健檢報告填寫頁）都走這裡。
export async function syncAppointmentJournal(appointment, { session } = {}) {
  if (appointmentJournalContent(appointment)) {
    await ClinicalNote.findOneAndUpdate({ appointmentId: appointment._id }, { $set: {
      petId: appointment.petId,
      entryDate: combineClinicDateTime(appointment.date, '10:00'),
      source: 'appointment',
    }, $unset: { content: '' } }, { upsert: true, runValidators: true, session });
  } else {
    await ClinicalNote.deleteOne({ appointmentId: appointment._id }).session(session);
  }
}
