import Appointment from '../models/Appointment.js';
import { combineClinicDateTime } from './clinicTime.js';
import { depositFieldsForBooking, settleCarriedDeposit } from './deposit.js';
import { workflowError } from './appointmentWorkflow.js';
import { APPOINTMENT_TIME_ERROR, isValidAppointmentTime, normalizeEstimatedDuration, normalizeSurgeryFields, validateAppointmentDuration } from './appointmentTime.js';

// 約回診：櫃台處理視窗（POST /workflow/followup）與出院視窗（POST /hospitalizations/:id/discharge）共用。
// 約回診跟新增掛號是同一套規則（lib/appointmentTime.js）：時段、預估診療時間、手術標記都一樣，
// 只多一條「不可早於本次就診」。改期既有的回診掛號時（existing），沒帶的欄位沿用那筆的值。
export function followUpBooking(body, appointment, existing = null) {
  const date = String(body.followUpDate || '');
  const time = String(body.followUpTime || '');
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date < appointment.date) {
    throw workflowError('請選擇有效的回診日期，且不可早於本次就診');
  }
  if (!time) throw workflowError('請選擇回診時段');
  if (!isValidAppointmentTime(time)) throw workflowError(APPOINTMENT_TIME_ERROR);
  const estimatedDurationMinutes = normalizeEstimatedDuration(body.estimatedDurationMinutes ?? existing?.estimatedDurationMinutes);
  validateAppointmentDuration(time, estimatedDurationMinutes);
  const { isSurgery, surgeryName } = normalizeSurgeryFields(body.isSurgery !== undefined || !existing ? body : existing);
  // 來院原因沒帶時用醫師寫的回診建議；櫃台送空白就是空白，不替使用者補字。
  const reason = String(body.reason ?? existing?.reason ?? appointment.followUpRecommendation ?? '').trim();
  return { date, time, estimatedDurationMinutes, isSurgery, surgeryName, reason };
}

// 在呼叫端的 transaction 裡約（或改期）這次看診的下一筆回診，並把日期時段與回診掛號 id 記在 appointment 上
// （呼叫端自己遞增版本號、存 appointment）。回傳 { followUp, previousDate }：previousDate 只有改期才有，廣播要通知舊的那一天。
export async function bookFollowUp(appointment, body, { session }) {
  let followUp;
  let previousDate = null;
  let booking;
  if (appointment.followUpAppointmentId) {
    followUp = await Appointment.findById(appointment.followUpAppointmentId).session(session);
    if (!followUp || followUp.status !== 'scheduled') throw workflowError('原回診預約已被處理，請從該筆預約確認安排', 409);
    booking = followUpBooking(body, appointment, followUp);
    previousDate = followUp.date;
    Object.assign(followUp, booking, { scheduledAt: combineClinicDateTime(booking.date, booking.time) });
    await followUp.save({ session });
  } else {
    booking = followUpBooking(body, appointment);
    // 約回診也是約診：這隻貓達到保證金門檻時（常常就是這次又遲到），一樣要先決定已收或這次不收。
    // 改期既有的回診不再問——那筆當初已經決定過了。
    const deposit = await depositFieldsForBooking(appointment.petId, body.deposit, session);
    await settleCarriedDeposit(deposit.carriedFromId, session);
    [followUp] = await Appointment.create([{
      ...deposit.fields,
      ...booking, scheduledAt: combineClinicDateTime(booking.date, booking.time),
      ownerId: appointment.ownerId, petId: appointment.petId,
      ownerName: appointment.ownerName, ownerPhone: appointment.ownerPhone,
      petName: appointment.petName, species: appointment.species, isStray: appointment.isStray === true,
      visitType: 'return',
      followUpOfId: appointment._id,
      templateId: appointment.templateId,
    }], { session });
    appointment.followUpAppointmentId = followUp._id;
  }
  appointment.followUpDate = booking.date;
  appointment.followUpTime = booking.time;
  return { followUp, previousDate };
}
