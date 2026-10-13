import ClinicalNote from '../models/ClinicalNote.js';
import LabResult from '../models/LabResult.js';
import { combineClinicDateTime } from './clinicTime.js';
import { appointmentJournalSections } from './appointmentWorkflow.js';

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

const VISIT_STATUSES = ['arrived', 'pending_checkout', 'completed'];

// 這次看診該不該有一筆病歷日誌（純邏輯）：
//   - 貓在院內或已完成才有。取消掛號、取消報到的看診沒有成立，不留在病歷上——
//     曾經取消過這件事記在出席紀錄（lib/attendance.js），不是病歷。
//   - 看診過（醫師開始看診、或已送交櫃台／完成）就有，不看有沒有填內容：有掛號、有看診，病歷上就該有這一次。
//   - 還在候診的（報到了、醫師還沒開始）要等有實際內容才有：剛報到的貓不該在病歷上多出一筆只有來院原因的空紀錄。
export function visitHasJournal(appointment, labResults = []) {
  if (!appointment?.petId || !VISIT_STATUSES.includes(appointment.status)) return false;
  if (appointment.visitStartedAt || appointment.handoffAt || appointment.deskCompletedAt) return true;
  return appointmentJournalSections(appointment, labResults).some((section) => section.key !== 'reason');
}

// 掛號日誌不存內容、讀取時由看診即時組出；這裡只確保「該有就有一筆、不該有就沒有」（visitHasJournal）。
// 日誌只是連結，拿掉不會遺失內容——重新報到後同步一次就回來。
// 看診的欄位從哪裡被改（診療台、健檢報告填寫頁）、報到與離開流程，以及 IDEXX 結果連上／解除這次看診，都走這裡。
// 日期只在建立時寫入（看診當天）：之後使用者可以從日誌改日期，重新同步不能把它蓋回去。
export async function syncAppointmentJournal(appointment, { session } = {}) {
  const labResults = (await linkedLabResults([appointment._id], { session })).get(String(appointment._id)) ?? [];
  if (visitHasJournal(appointment, labResults)) {
    await ClinicalNote.findOneAndUpdate({ appointmentId: appointment._id }, {
      $set: { petId: appointment.petId, source: 'appointment' },
      $setOnInsert: { entryDate: combineClinicDateTime(appointment.date, '10:00') },
      $unset: { content: '' },
    }, { upsert: true, runValidators: true, session });
  } else {
    await ClinicalNote.deleteOne({ appointmentId: appointment._id }).session(session ?? null);
  }
}
