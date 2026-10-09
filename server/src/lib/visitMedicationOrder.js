import MedicationOrder from '../models/MedicationOrder.js';
import Appointment from '../models/Appointment.js';
import { MEDICATION_ACTIVE } from '../../../shared/medicationWorkflow.js';
import { richTextToPlain } from '../../../shared/richText.js';
import { recordMedicationEvent } from './medicationWorkflow.js';

// 診療台的「藥單」欄位 ↔ 藥單（medicationOrders）。
// 醫師寫的藥單存在看診上（appointment.prescription），送交櫃台的那一刻才在藥單建立一筆——
// 自動存檔打到一半的字不該出現在櫃台的待包藥清單。醫師自己寫的，所以直接是「待包藥」，不必再審一次。

const hasText = (value) => Boolean(richTextToPlain(value).trim());

// 送交櫃台時這張藥單該怎麼辦：none 不動／create 新開一張／update 換成新內容／cancel 醫師把藥單清空了。
// order：這次看診目前連著的藥單（沒有就 null）。
export function planVisitMedication(prescription, order) {
  const text = String(prescription ?? '').trim();
  const filled = hasText(text);
  if (!order || !MEDICATION_ACTIVE.includes(order.status)) {
    // 已領藥或已取消的那張不回頭改：內容不同才另開一張。
    return filled && (!order || order.prescription !== text) ? 'create' : 'none';
  }
  if (!filled) return 'cancel';
  return order.prescription === text ? 'none' : 'update';
}

// 看診送交櫃台時呼叫（同一個 transaction）。回傳有變動的藥單（沒有變動回 null），呼叫端提交後才廣播。
export async function syncVisitMedicationOrder(appointment, actor, { session, now = new Date() } = {}) {
  const text = String(appointment.prescription ?? '').trim();
  const order = appointment.medicationOrderId
    ? await MedicationOrder.findById(appointment.medicationOrderId).session(session ?? null)
    : null;
  const plan = planVisitMedication(text, order);
  if (plan === 'none') return null;

  if (plan === 'create') {
    const created = new MedicationOrder({
      petId: appointment.petId, ownerId: appointment.ownerId, appointmentId: appointment._id, fromVisit: true,
      petName: appointment.petName, ownerName: appointment.ownerName, ownerPhone: appointment.ownerPhone,
      prescription: text,
    });
    recordMedicationEvent(created, 'create', actor, '', '', now);
    created.status = 'approved';
    created.approvedAt = now;
    created.approvedBy = actor;
    recordMedicationEvent(created, 'approve', actor, 'review', '', now);
    await created.save({ session });
    appointment.medicationOrderId = created._id;
    return created;
  }

  const from = order.status;
  if (plan === 'cancel') {
    order.status = 'cancelled';
    recordMedicationEvent(order, 'cancel', actor, from, '醫師在診療台清空了藥單', now);
    appointment.medicationOrderId = null;
  } else {
    // 醫師取回後改了藥單：已包好的要重包，其餘照樣是待包藥。
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
  return order;
}

// 看診離開流程（取消掛號、未到、取消報到）：這次看診沒有成立，診療台開的那張藥單還沒領走就一併取消，
// 櫃台才不會照著包藥。已領藥的不動（藥已經交出去了）。醫師寫的內容留在看診上，之後恢復、重新送交時會再開一張。
// 回傳被取消的藥單（沒有回 null），呼叫端存好掛號後才廣播。
export async function cancelVisitMedicationOrder(appointment, reason, { session, now = new Date() } = {}) {
  if (!appointment.medicationOrderId) return null;
  const order = await MedicationOrder.findById(appointment.medicationOrderId).session(session ?? null);
  appointment.medicationOrderId = null;
  if (!order || !MEDICATION_ACTIVE.includes(order.status)) return null;
  const from = order.status;
  order.status = 'cancelled';
  recordMedicationEvent(order, 'cancel', '', from, reason, now);
  await order.save({ session });
  return order;
}

// 反方向：診療台開的藥單在藥單那邊被修改或取消後，把內容寫回那次看診，病歷日誌上的「藥單」才跟著變
// （取消＝沒有真的開出去，從日誌拿掉）。不動 __v——這不是誰在編輯這筆掛號。回傳有變動的掛號（沒有回 null）。
export async function writeBackVisitPrescription(order, { session } = {}) {
  if (!order.fromVisit) return null;
  const cancelled = order.status === 'cancelled';
  const text = cancelled ? '' : order.prescription;
  return Appointment.findOneAndUpdate(
    { medicationOrderId: order._id, ...(cancelled ? {} : { prescription: { $ne: text } }) },
    { $set: { prescription: text, ...(cancelled ? { medicationOrderId: null } : {}) } },
    { new: true, session },
  );
}
