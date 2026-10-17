import MedicationOrder from '../models/MedicationOrder.js';
import HospitalizationEntry from '../models/HospitalizationEntry.js';
import { MEDICATION_ACTIVE } from '../../../shared/medicationWorkflow.js';
import { planVisitMedication } from './visitMedicationOrder.js';
import { recordMedicationEvent } from './medicationWorkflow.js';
import { syncMedicationJournal } from './medicationJournal.js';

// 住院照護紀錄的「開藥」欄位 ↔ 藥單（medicationOrders）。
// 開藥是醫師開的處方簽（不是住院期間餵藥打針的「用藥紀錄」）：存的當下就在藥單開一筆「待包藥」，
// 醫師自己開的不必再審（history 記 create＋approve），櫃台照一般藥單包藥領藥，而且有自己的領藥日誌——
// 病歷日誌查得到之前開過什麼藥。規則跟診療台的藥單一樣（planVisitMedication）：
// 同一格再存、內容變了就更新同一張（已包好的標需重新包藥）、清空就取消；已領藥的不回頭改，內容不同才另開一張。

// 存了一格照護紀錄（entry.prescription 已經是新內容）之後呼叫，同一個 transaction。
// owner：{ ownerId, petName, ownerName, ownerPhone }。回傳有變動的藥單（沒有變動回 null）；
// 呼叫端要在 entry.medicationOrderId 變了時存回這格，提交後才廣播。
export async function syncEntryMedicationOrder(entry, owner, actor, { session, now = new Date() } = {}) {
  const text = String(entry.prescription ?? '').trim();
  const order = entry.medicationOrderId
    ? await MedicationOrder.findById(entry.medicationOrderId).session(session ?? null)
    : null;
  const plan = planVisitMedication(text, order);
  if (plan === 'none') return null;

  if (plan === 'create') {
    const created = new MedicationOrder({
      petId: entry.petId, ownerId: owner.ownerId, hospitalizationId: entry.hospitalizationId, hospitalizationEntryId: entry._id,
      petName: owner.petName, ownerName: owner.ownerName, ownerPhone: owner.ownerPhone,
      prescription: text,
    });
    recordMedicationEvent(created, 'create', actor, '', '住院開藥', now);
    created.status = 'approved';
    created.approvedAt = now;
    created.approvedBy = actor;
    recordMedicationEvent(created, 'approve', actor, 'review', '', now);
    await created.save({ session });
    await syncMedicationJournal(created, { session });
    entry.medicationOrderId = created._id;
    return created;
  }

  const from = order.status;
  if (plan === 'cancel') {
    order.status = 'cancelled';
    recordMedicationEvent(order, 'cancel', actor, from, '住院紀錄清空了開藥', now);
    entry.medicationOrderId = null;
  } else {
    order.prescription = text;
    order.needsRepack ||= from === 'ready';
    order.status = 'approved';
    order.approvedAt = now;
    order.approvedBy = actor;
    order.packedAt = null;
    order.packedBy = '';
    recordMedicationEvent(order, 'approve', actor, from, '', now);
  }
  await order.save({ session });
  await syncMedicationJournal(order, { session });
  return order;
}

// 刪掉一格照護紀錄：連著的藥單還沒領走就一併取消，櫃台才不會照著包藥。已領藥的不動。回傳被取消的藥單（沒有回 null）。
export async function cancelEntryMedicationOrder(entry, reason, { session, now = new Date() } = {}) {
  if (!entry.medicationOrderId) return null;
  const order = await MedicationOrder.findById(entry.medicationOrderId).session(session ?? null);
  if (!order || !MEDICATION_ACTIVE.includes(order.status)) return null;
  const from = order.status;
  order.status = 'cancelled';
  recordMedicationEvent(order, 'cancel', '', from, reason, now);
  await order.save({ session });
  await syncMedicationJournal(order, { session });
  return order;
}

// 反方向：開藥開出去的藥單在藥單那邊（或病歷日誌上）被修改或取消後，把內容寫回那一格照護紀錄，住院專區才跟著變
// （取消＝沒有真的開出去，清空並解除關聯）。不動 __v——這不是誰在編輯這格。回傳有變動的那格（沒有回 null）。
export async function writeBackEntryPrescription(order, { session } = {}) {
  if (!order.hospitalizationEntryId) return null;
  const cancelled = order.status === 'cancelled';
  const text = cancelled ? '' : order.prescription;
  return HospitalizationEntry.findOneAndUpdate(
    { medicationOrderId: order._id, ...(cancelled ? {} : { prescription: { $ne: text } }) },
    { $set: { prescription: text, ...(cancelled ? { medicationOrderId: null } : {}) } },
    { new: true, session },
  );
}
