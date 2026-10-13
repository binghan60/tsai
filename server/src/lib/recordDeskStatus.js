import Appointment from '../models/Appointment.js';
import { deskProcessingState } from '../../../shared/appointmentWorkflow.js';

// 報告清單每一列的「櫃台處理狀態」：由連著的看診（掛號的 recordId）即時推導，不另存欄位。
// 一次查整頁（走 { recordId } partial 索引），沒連著看診的報告不在結果裡。
export async function deskStatusByRecordId(recordIds) {
  const ids = recordIds.filter(Boolean);
  if (!ids.length) return new Map();
  const appointments = await Appointment.find({ recordId: { $in: ids } })
    .select('recordId status reopenRequest')
    .lean();
  return new Map(appointments.map((item) => [String(item.recordId), deskProcessingState(item)]));
}
