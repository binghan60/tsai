import ClinicalNote from '../models/ClinicalNote.js';
import { emitClinicalNoteUpdate } from './realtime.js';

// 藥單 → 病歷日誌。跟掛號日誌同一個做法：日誌只存關聯，內容由藥單即時組成，
// 所以這裡只負責「有沒有這筆日誌」與「歸在哪天」，藥單內容之後怎麼改都不必再同步。
// 一張藥單一筆日誌，跟看診（掛號）那筆各自獨立，不會併進去。
//
// 建立藥單時就開始有這筆日誌（標題會標明「待醫師確認」等階段），跟掛號日誌在看診中就出現一致；
// 藥單取消就刪掉——取消的藥單沒有真的開出去，不該留在病歷裡。
// 必須跟藥單本身的儲存放在同一個 transaction，呼叫端傳入 session。
export async function syncMedicationJournal(order, { session } = {}) {
  if (order.status === 'cancelled') {
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
