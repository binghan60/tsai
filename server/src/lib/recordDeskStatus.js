import Appointment from '../models/Appointment.js';
import { deskProcessingState } from '../../../shared/appointmentWorkflow.js';

// 看診報告與看診的關聯：掛號的 recordId 指向報到時建立的那份（修訂鏈的根），報告上不另存。
// 修訂版沿著 revisionRootId 找回同一筆看診；獨立報告（清單頁直接新增、沒有掛號）沒有對應看診。
export const rootRecordId = (record) => record.revisionRootId || record._id;

// 櫃台處理勾了「這次看診不寄就診紀錄」：這份報告不能寄 Email（手動與自動都擋），要寄請櫃台先取消勾選。
export const NO_VISIT_RECORD_MESSAGE = '櫃台設定這次看診不寄就診紀錄，不能寄送 Email；要寄請櫃台先取消該勾選';

const hasNoVisitItem = (appointment) => (appointment?.deskItems ?? []).includes('no_visit_record');

// 預覽頁「對應看診」那一條的資料：看診日期、櫃台處理狀態、是否不寄就診紀錄。沒有對應看診回 null。
// 只讀關聯，不疊值（已結案的內容讀快照；草稿的疊值走 visitOverlay）。
export async function visitInfoForRecord(record) {
  const appointment = await Appointment.findOne({ recordId: rootRecordId(record) })
    .select('_id date status reopenRequest deskItems')
    .lean();
  if (!appointment) return null;
  return {
    appointmentId: appointment._id,
    date: appointment.date,
    deskStatus: deskProcessingState(appointment),
    noVisitRecord: hasNoVisitItem(appointment),
  };
}

// 自動寄送要等櫃台完成處理：醫師常常看完診就先寫報告、結案，飼主到了櫃台才說不要寄或還有別的事。
// 回傳這批報告裡「連著看診、而櫃台還沒按完成處理」的那些的根 id（修訂版沿 revisionRootId 找同一筆看診）；
// 沒連著看診的舊獨立報告、補登的看診（建立時就是已完成）都不在裡面。
export async function rootIdsAwaitingDesk(records) {
  const rootIds = [...new Set(records.filter((record) => record?._id).map((record) => String(rootRecordId(record))))];
  if (!rootIds.length) return new Set();
  const waiting = await Appointment.find({ recordId: { $in: rootIds }, deskCompletedAt: null }).select('recordId').lean();
  return new Set(waiting.map((appointment) => String(appointment.recordId)));
}

export async function hasNoVisitRecord(record) {
  if (!record?._id) return false;
  return Boolean(await Appointment.exists({ recordId: rootRecordId(record), deskItems: 'no_visit_record' }));
}

// 報告清單每一列的「櫃台處理狀態」：由連著的看診即時推導，不另存欄位。
// 一次查整頁（走 { recordId } partial 索引），沒連著看診的報告不在結果裡。結果以報告自己的 _id 為鍵。
export async function deskStatusByRecordId(records) {
  const rootOf = new Map(records.filter((record) => record?._id).map((record) => [String(record._id), String(rootRecordId(record))]));
  const rootIds = [...new Set(rootOf.values())];
  if (!rootIds.length) return new Map();
  const appointments = await Appointment.find({ recordId: { $in: rootIds } })
    .select('recordId date status reopenRequest deskItems')
    .lean();
  const byRoot = new Map(appointments.map((item) => [String(item.recordId), {
    deskStatus: deskProcessingState(item),
    noVisitRecord: hasNoVisitItem(item),
    visit: { appointmentId: item._id, date: item.date },
  }]));
  const result = new Map();
  for (const [recordId, rootId] of rootOf) {
    if (byRoot.has(rootId)) result.set(recordId, byRoot.get(rootId));
  }
  return result;
}
