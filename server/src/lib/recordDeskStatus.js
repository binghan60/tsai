import Appointment from '../models/Appointment.js';
import { deskProcessingState } from '../../../shared/appointmentWorkflow.js';

// 報告清單每一列的「櫃台處理狀態」：由連著的看診（掛號的 recordId）即時推導，不另存欄位。
// 一次查整頁（走 { recordId } partial 索引），沒連著看診的報告不在結果裡。
// 另帶 noVisitRecord：櫃台處理視窗勾了「這次看診不寄就診紀錄」，清單上要標出來。
// 櫃台處理勾了「這次看診不寄就診紀錄」：這份報告不能寄 Email（手動與自動都擋），要寄請櫃台先取消勾選。
export const NO_VISIT_RECORD_MESSAGE = '櫃台設定這次看診不寄就診紀錄，不能寄送 Email；要寄請櫃台先取消該勾選';
export async function hasNoVisitRecord(recordId) {
  if (!recordId) return false;
  return Boolean(await Appointment.exists({ recordId, deskItems: 'no_visit_record' }));
}

export async function deskStatusByRecordId(recordIds) {
  const ids = recordIds.filter(Boolean);
  if (!ids.length) return new Map();
  const appointments = await Appointment.find({ recordId: { $in: ids } })
    .select('recordId status reopenRequest deskItems')
    .lean();
  return new Map(appointments.map((item) => [String(item.recordId), {
    deskStatus: deskProcessingState(item),
    noVisitRecord: (item.deskItems ?? []).includes('no_visit_record'),
  }]));
}
