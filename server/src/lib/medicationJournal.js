import ClinicalNote from '../models/ClinicalNote.js';
import { emitClinicalNoteUpdate } from './realtime.js';

// 藥單 → 病歷日誌。跟掛號日誌同一個做法：日誌只存關聯，內容由藥單即時組成，
// 所以這裡只負責「有沒有這筆日誌」與「歸在哪天」，藥單內容之後怎麼改都不必再同步。
// 一張藥單一筆日誌，跟看診（掛號）那筆各自獨立，不會併進去。
//
// 不變式：日誌存在 ⇔ 這張藥單**曾經被醫師審核過**，而且沒有取消。
//   - 審核之前（櫃台剛登記、醫師還沒看）不進病歷：病歷記的是醫師確認過的內容，不是草稿。
//   - 審核之後就一直在：之後被退回、修改、重新審核，日誌只是標題階段回到「待醫師確認」，不會消失又出現。
//   - 取消就刪掉：取消的藥單沒有真的開出去，不該留在病歷裡。
// 「曾經審核過」看 history，不看 approvedAt——退回與修改會把 approvedAt 清掉，history 不會。
// 必須跟藥單本身的儲存放在同一個 transaction，呼叫端傳入 session。
export const hasBeenApproved = (order) => (order.history ?? []).some((event) => event.action === 'approve');

export async function syncMedicationJournal(order, { session } = {}) {
  if (order.status === 'cancelled' || !hasBeenApproved(order)) {
    // 該不存在的一律刪：取消是正常路徑；未審核時通常本來就沒有，刪除是無害的空操作。
    await ClinicalNote.deleteOne({ medicationOrderId: order._id }, { session });
    return;
  }
  await ClinicalNote.findOneAndUpdate(
    { medicationOrderId: order._id },
    { $set: { petId: order.petId, entryDate: order.createdAt ?? new Date(), source: 'medication' }, $unset: { content: '' } },
    { upsert: true, runValidators: true, session }
  );
}

// 交易提交之後才通知：讓開著這隻寵物病歷日誌的畫面重新讀取。
export function announceMedicationJournal(order) {
  emitClinicalNoteUpdate({ petId: order.petId, medicationOrderId: order._id });
}
