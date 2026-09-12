import { Router } from 'express';
import mongoose from 'mongoose';
import Appointment from '../models/Appointment.js';
import ClinicalNote from '../models/ClinicalNote.js';
import MedicalRecord from '../models/MedicalRecord.js';
import FormTemplate from '../models/FormTemplate.js';
import { withTransaction } from '../lib/transaction.js';
import { combineClinicDateTime } from '../lib/clinicTime.js';
import { defaultRecordFields } from '../lib/formTemplate.js';
import { emitAppointmentUpdate } from '../lib/realtime.js';
import { applyWorkflowAction, appointmentJournalContent, assertWorkflowVersion, workflowError } from '../lib/appointmentWorkflow.js';

const router = Router({ mergeParams: true });

function validateFollowUp(date, time, appointmentDate) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date < appointmentDate) {
    throw workflowError('請選擇有效的回診日期，且不可早於本次就診');
  }
  if (!/^\d{2}:\d{2}$/.test(time)) throw workflowError('請選擇回診時間');
  const [hour, minute] = time.split(':').map(Number);
  const minutes = hour * 60 + minute;
  if (hour > 23 || minute > 59 || minute % 5 || !((minutes >= 600 && minutes <= 690) || (minutes >= 840 && minutes <= 1170))) {
    throw workflowError('回診時段僅限 10:00–11:30、14:00–19:30，且每 5 分鐘一格');
  }
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
    const action = req.params.action;
    await withTransaction(async (session) => {
      followUp = null;
      followUpPreviousDate = null;
      record = null;
      appointment = await Appointment.findById(req.params.id).session(session);
      if (!appointment) throw workflowError('找不到掛號', 404);
      assertWorkflowVersion(appointment, req.body.version);
      applyWorkflowAction(appointment, action, req.body);

      // 即使只填交辦或直接完成看診，也要將來院原因保存到當次日誌。
      if (action === 'clinical' || action === 'handoff') {
        const journalContent = appointmentJournalContent(appointment);
        if (journalContent) {
          await ClinicalNote.findOneAndUpdate({ appointmentId: appointment._id }, { $set: {
            petId: appointment.petId,
            entryDate: combineClinicDateTime(appointment.date, '10:00'),
            source: 'appointment',
          }, $unset: { content: '' } }, { upsert: true, runValidators: true, session });
        } else {
          await ClinicalNote.deleteOne({ appointmentId: appointment._id }).session(session);
        }
      }

      if (action === 'record') {
        if (appointment.recordId) {
          record = await MedicalRecord.findById(appointment.recordId).session(session);
          if (!record) throw workflowError('原綁定表單已不存在，請先確認就診紀錄', 409);
        } else {
          const templateId = req.body.templateId || appointment.templateId;
          if (!mongoose.isValidObjectId(templateId)) throw workflowError('請選擇正式表單');
          const template = await FormTemplate.findOne({ _id: templateId, enabled: { $ne: false } }).session(session);
          if (!template) throw workflowError('表單不存在或已停用');
          [record] = await MedicalRecord.create([{
            petId: appointment.petId,
            ...defaultRecordFields(template),
            visitDate: combineClinicDateTime(appointment.date, '10:00'),
            chiefComplaint: appointment.reason,
            weightKg: appointment.weightKg,
            temperatureC: appointment.temperatureC,
            templateId: template._id,
            templateVersion: template.version,
            examType: template.name,
          }], { session });
          appointment.recordId = record._id;
          appointment.templateId = template._id;
        }
      }

      if (action === 'followup') {
        const date = String(req.body.followUpDate || '');
        const time = String(req.body.followUpTime || '');
        validateFollowUp(date, time, appointment.date);
        if (appointment.followUpAppointmentId) {
          followUp = await Appointment.findById(appointment.followUpAppointmentId).session(session);
          if (!followUp || followUp.status !== 'scheduled') throw workflowError('原回診預約已被處理，請從該筆預約確認安排', 409);
          followUpPreviousDate = followUp.date;
          followUp.date = date;
          followUp.time = time;
          followUp.scheduledAt = combineClinicDateTime(date, time);
          await followUp.save({ session });
        } else {
          [followUp] = await Appointment.create([{
            date, time, scheduledAt: combineClinicDateTime(date, time),
            ownerId: appointment.ownerId, petId: appointment.petId,
            ownerName: appointment.ownerName, ownerPhone: appointment.ownerPhone,
            petName: appointment.petName, species: appointment.species,
            visitType: 'return', reason: appointment.followUpReason || appointment.followUpRecommendation || '回診',
            templateId: appointment.templateId,
          }], { session });
          appointment.followUpAppointmentId = followUp._id;
        }
        appointment.followUpDate = date;
        appointment.followUpTime = time;
      }
      if (action === 'clinical' && appointment.recordId) {
        const measurements = {};
        for (const key of ['weightKg', 'temperatureC']) {
          if (req.body[key] !== undefined) measurements[key] = appointment[key];
        }
        if (Object.keys(measurements).length) {
          await MedicalRecord.updateOne({ _id: appointment.recordId, status: 'draft' }, { $set: measurements, $inc: { __v: 1 } }, { session });
        }
      }
      // Even no-op commands advance the revision, so stale confirmations cannot succeed.
      appointment.increment();
      await appointment.save({ session });
    });
    emitAppointmentUpdate(appointment);
    if (followUp) emitAppointmentUpdate(followUp, followUpPreviousDate);
    res.json({ ...appointment.toObject(), ...(record ? { record } : {}) });
  } catch (err) {
    if (err.name === 'VersionError' || err.code === 112) return res.status(409).json({ message: '資料已更新，請載入最新內容後再確認' });
    next(err);
  }
});

export default router;
