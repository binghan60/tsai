import { Router } from 'express';
import { applyPendingLabResults } from '../lib/labResultApply.js';
import mongoose from 'mongoose';
import Appointment from '../models/Appointment.js';
import MedicalRecord from '../models/MedicalRecord.js';
import FormTemplate from '../models/FormTemplate.js';
import { withTransaction } from '../lib/transaction.js';
import { combineClinicDateTime } from '../lib/clinicTime.js';
import { depositFieldsForBooking, settleCarriedDeposit } from '../lib/deposit.js';
import { defaultRecordFields } from '../lib/formTemplate.js';
import { emitAppointmentUpdate, emitMedicationUpdate } from '../lib/realtime.js';
import { syncVisitMedicationOrder } from '../lib/visitMedicationOrder.js';
import { queueIdexxCensus } from '../lib/idexxRequests.js';
import { applyWorkflowAction, assertWorkflowVersion, workflowError } from '../lib/appointmentWorkflow.js';
import { syncAppointmentJournal } from '../lib/appointmentJournal.js';
import { syncImageUploadTodo } from '../lib/imageUploadTodo.js';
import { publishTodos } from '../lib/todos.js';
import { STAFF_SENDERS } from '../lib/pinnedPets.js';
import { templateLabItems } from '../lib/recordVisitLink.js';
import { APPOINTMENT_TIME_ERROR, isValidAppointmentTime, normalizeEstimatedDuration, normalizeSurgeryFields, validateAppointmentDuration } from '../lib/appointmentTime.js';

const router = Router({ mergeParams: true });

// 約回診跟新增掛號是同一套規則（lib/appointmentTime.js）：時段、預估診療時間、手術標記都一樣，
// 只多一條「不可早於本次就診」。改期既有的回診掛號時（existing），沒帶的欄位沿用那筆的值。
function followUpBooking(body, appointment, existing = null) {
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
  // 來院原因沒帶時用醫師寫的回診原因；櫃台送空白就是空白，不替使用者補字。
  const reason = String(body.reason ?? existing?.reason ?? (appointment.followUpReason || appointment.followUpRecommendation || '')).trim();
  return { date, time, estimatedDurationMinutes, isSurgery, surgeryName, reason };
}

// A single transaction protects the appointment, diary, follow-up and linked draft.
// Expected version prevents one station from silently overwriting another station's work.
router.post('/:action', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw workflowError('掛號編號格式不正確');
    let appointment;
    let followUp;
    let followUpPreviousDate;
    let record;
    let todosChanged;
    let medicationOrder;
    const action = req.params.action;
    await withTransaction(async (session) => {
      followUp = null;
      followUpPreviousDate = null;
      record = null;
      todosChanged = false;
      medicationOrder = null;
      appointment = await Appointment.findById(req.params.id).session(session);
      if (!appointment) throw workflowError('找不到掛號', 404);
      assertWorkflowVersion(appointment, req.body.version);
      // 檢驗數值要對著這次掛號範本的檢驗項目驗證。
      let labItems = [];
      if (action === 'clinical' && req.body.labValues !== undefined) {
        const template = appointment.templateId ? await FormTemplate.findById(appointment.templateId).session(session) : null;
        labItems = templateLabItems(template);
      }
      const imageUploadBefore = Boolean(appointment.imageUpload);
      applyWorkflowAction(appointment, action, req.body, new Date(), { labItems });
      // 「上傳影像」勾起來或取消：同一個 transaction 裡新增／收掉那筆院內待辦。staff＝操作的那台裝置的身分。
      if (Boolean(appointment.imageUpload) !== imageUploadBefore) {
        const createdBy = STAFF_SENDERS.includes(req.body.staff) ? req.body.staff : 'front_desk';
        todosChanged = await syncImageUploadTodo(appointment, createdBy, { session });
      }

      // 送交櫃台：醫師寫的藥單這一刻才在藥單建立（或更新）一筆，直接是待包藥。
      if (action === 'handoff') medicationOrder = await syncVisitMedicationOrder(appointment, req.user?.username || '', { session });

      // 直接完成看診沒填任何東西時，來院原因也算內容。
      if (action === 'clinical' || action === 'handoff') await syncAppointmentJournal(appointment, { session });

      if (action === 'record') {
        if (appointment.recordId) {
          record = await MedicalRecord.findById(appointment.recordId).session(session);
          if (!record) throw workflowError('原綁定表單已不存在，請先確認健檢報告', 409);
        } else {
          const templateId = req.body.templateId || appointment.templateId;
          if (!mongoose.isValidObjectId(templateId)) throw workflowError('請選擇正式表單');
          const template = await FormTemplate.findOne({ _id: templateId, enabled: { $ne: false } }).session(session);
          if (!template) throw workflowError('表單不存在或已停用');
          [record] = await MedicalRecord.create([{
            petId: appointment.petId,
            ...defaultRecordFields(template),
            visitDate: combineClinicDateTime(appointment.date, appointment.time || '10:00'),
            chiefComplaint: appointment.reason,
            templateId: template._id,
            templateVersion: template.version,
            examType: template.name,
          }], { session });
          appointment.recordId = record._id;
          appointment.templateId = template._id;
        }
      }

      if (action === 'followup') {
        let booking;
        if (appointment.followUpAppointmentId) {
          followUp = await Appointment.findById(appointment.followUpAppointmentId).session(session);
          if (!followUp || followUp.status !== 'scheduled') throw workflowError('原回診預約已被處理，請從該筆預約確認安排', 409);
          booking = followUpBooking(req.body, appointment, followUp);
          followUpPreviousDate = followUp.date;
          Object.assign(followUp, booking, { scheduledAt: combineClinicDateTime(booking.date, booking.time) });
          await followUp.save({ session });
        } else {
          booking = followUpBooking(req.body, appointment);
          // 約回診也是約診：這隻貓達到保證金門檻時（常常就是這次又遲到），一樣要先決定已收或這次不收。
          // 改期既有的回診不再問——那筆當初已經決定過了。
          const deposit = await depositFieldsForBooking(appointment.petId, req.body.deposit, session);
          await settleCarriedDeposit(deposit.carriedFromId, session);
          [followUp] = await Appointment.create([{
            ...deposit.fields,
            ...booking, scheduledAt: combineClinicDateTime(booking.date, booking.time),
            ownerId: appointment.ownerId, petId: appointment.petId,
            ownerName: appointment.ownerName, ownerPhone: appointment.ownerPhone,
            petName: appointment.petName, species: appointment.species,
            visitType: 'return',
            followUpOfId: appointment._id,
            templateId: appointment.templateId,
          }], { session });
          appointment.followUpAppointmentId = followUp._id;
        }
        appointment.followUpDate = booking.date;
        appointment.followUpTime = booking.time;
      }
      // Even no-op commands advance the revision, so stale confirmations cannot succeed.
      appointment.increment();
      await appointment.save({ session });
    });
    // 櫃台完成處理＝離開診所：從 IDEXX 主機的在院清單收掉（伺服器有開才會排隊）。
    if (action === 'complete') await queueIdexxCensus(appointment);
    emitAppointmentUpdate(appointment);
    if (todosChanged) await publishTodos();
    if (medicationOrder) emitMedicationUpdate(medicationOrder);
    if (followUp) emitAppointmentUpdate(followUp, followUpPreviousDate);
    res.json({ ...appointment.toObject(), ...(record ? { record } : {}) });
    // 這次才選了表單（建立報告草稿）：先前驗好、填不進來的檢驗結果現在補上。
    if (action === 'record') await applyPendingLabResults(appointment);
  } catch (err) {
    if (err.name === 'VersionError' || err.code === 112) return res.status(409).json({ message: '資料已更新，請載入最新內容後再確認' });
    next(err);
  }
});

export default router;
