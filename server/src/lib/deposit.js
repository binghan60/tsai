import mongoose from 'mongoose';
import Appointment from '../models/Appointment.js';
import { attendanceCountPipeline, attendanceCounts } from './attendance.js';
import { DEPOSIT_AMOUNT, checkDepositDecision, depositRequired } from '../../../shared/deposit.js';

function withSession(query, session) {
  return session ? query.session(session) : query;
}

// 取消了、但保證金留在診所的那筆掛號（取消時櫃台選「先留著」）。下次約診沿用這筆錢，不再收一次。
function heldDeposit(id, session) {
  const query = Appointment.findOne({ petId: id, status: 'cancelled', depositStatus: 'collected' })
    .sort({ depositDecidedAt: -1 })
    .select('depositDecidedAt')
    .lean();
  return withSession(query, session);
}

// 這隻貓現在約診要不要先收保證金（規則見 shared/deposit.js）。
// 「收了就歸零」：只算上次收保證金那一刻之後才排定的掛號——收保證金是約下一次診時發生的，
// 在那之前的遲到與未到已經用那筆保證金處理過了。選「這次不收」不算收、不歸零；
// 取消時退還的（refunded）也不算，次數回到收之前。沿用到下一筆的（carried）錢已經記在那一筆上。
export async function petDepositState(petId, session = null) {
  const id = new mongoose.Types.ObjectId(String(petId));
  const lastQuery = Appointment.findOne({ petId: id, depositStatus: 'collected' }).sort({ depositDecidedAt: -1 }).select('depositDecidedAt').lean();
  const last = await withSession(lastQuery, session);
  const since = last?.depositDecidedAt ?? null;
  const pipeline = attendanceCountPipeline({ petId: id, ...(since ? { scheduledAt: { $gt: since } } : {}) });
  const counts = attendanceCounts(await withSession(Appointment.aggregate(pipeline), session));
  const required = depositRequired(counts);
  // 還要收新的保證金時不談沿用：那代表收了之後又遲到或未到，留著的那筆由櫃台自己處理。
  const held = required ? null : await heldDeposit(id, session);
  return {
    required,
    amount: DEPOSIT_AMOUNT,
    lateCount: counts.lateCount,
    noShowCount: counts.noShowCount,
    since,
    held: held ? { appointmentId: held._id, decidedAt: held.depositDecidedAt } : null,
  };
}

// 建立掛號時要寫進去的三個欄位（fields）。需要收卻沒決定時丟 422（帶 depositRequired 讓前端知道是這件事）。
// 有留著的保證金時直接沿用：新掛號記成已收（決定時間沿用原本那筆，歸零的起點才不會往後移），
// 並回 carriedFromId——呼叫端建立成功後要用 settleCarriedDeposit 把原本那筆改成「已沿用」。
export async function depositFieldsForBooking(petId, input, session = null) {
  if (!petId) return { fields: { depositStatus: '', depositWaiveReason: '', depositDecidedAt: null }, carriedFromId: null };
  const state = await petDepositState(petId, session);
  if (state.held) {
    return {
      fields: { depositStatus: 'collected', depositWaiveReason: '', depositDecidedAt: state.held.decidedAt },
      carriedFromId: state.held.appointmentId,
    };
  }
  const decision = checkDepositDecision(input, state.required);
  if (decision.error) {
    const error = new Error(decision.error);
    error.status = 422;
    error.details = { depositRequired: true };
    throw error;
  }
  return {
    fields: {
      depositStatus: decision.status,
      depositWaiveReason: decision.reason,
      depositDecidedAt: decision.status ? new Date() : null,
    },
    carriedFromId: null,
  };
}

export async function settleCarriedDeposit(carriedFromId, session = null) {
  if (!carriedFromId) return;
  await Appointment.updateOne(
    { _id: carriedFromId, depositStatus: 'collected' },
    { $set: { depositStatus: 'carried' } },
    session ? { session } : undefined,
  );
}
