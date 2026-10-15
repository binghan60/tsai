import Appointment from '../models/Appointment.js';
import { clinicToday } from './clinicTime.js';

// 掛號上的流浪貓標記是快照（卡片畫徽章用）。貓咪資料改了標記時，跟著改這隻貓今天以後的掛號；
// 過去的掛號留著當時的樣子。只是顯示用的快照、不是誰在編輯的內容，所以不推進版本號（不讓開著的畫面送出時撞 409）。
// 回傳改過的掛號，呼叫端在 transaction 成功後逐筆廣播。
export async function syncStraySnapshots(petId, isStray, { session = null } = {}) {
  const filter = { petId, date: { $gte: clinicToday() }, isStray: { $ne: isStray } };
  const ids = (await Appointment.find(filter).select('_id').session(session).lean()).map((item) => item._id);
  if (!ids.length) return [];
  await Appointment.updateMany({ _id: { $in: ids } }, { $set: { isStray } }, { session });
  return Appointment.find({ _id: { $in: ids } }).session(session);
}

// 換飼主：還沒報到的掛號改成新飼主（快照一起換）；已經發生的看診、報告、藥單保留當時的飼主名字。
// 掛號台開著修改視窗的裝置手上的版本要失效，所以推進版本號。
export async function moveScheduledAppointments(petId, owner, isStray, { session = null } = {}) {
  const ids = (await Appointment.find({ petId, status: 'scheduled' }).select('_id').session(session).lean()).map((item) => item._id);
  if (!ids.length) return [];
  await Appointment.updateMany(
    { _id: { $in: ids } },
    { $set: { ownerId: owner._id, ownerName: owner.name, ownerPhone: owner.phone ?? '', isStray }, $inc: { __v: 1 } },
    { session },
  );
  return Appointment.find({ _id: { $in: ids } }).session(session);
}
