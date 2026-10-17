import { Router } from 'express';
import { applyPendingLabResults } from '../lib/labResultApply.js';
import mongoose from 'mongoose';
import Appointment from '../models/Appointment.js';
import MedicalRecord from '../models/MedicalRecord.js';
import FormTemplate from '../models/FormTemplate.js';
import { withTransaction } from '../lib/transaction.js';
import { combineClinicDateTime } from '../lib/clinicTime.js';
import { bookFollowUp } from '../lib/followUp.js';
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
import { notifyDeskCompleted } from '../lib/deskEvents.js';

const router = Router({ mergeParams: true });

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
      // 收了住院的看診不開藥單（院內用藥記在住院紀錄，帶回家的藥出院時開）。
      if (action === 'handoff' && !appointment.hospitalizationId) medicationOrder = await syncVisitMedicationOrder(appointment, req.user?.username || '', { session });

      // 病歷日誌跟著看診走（lib/appointmentJournal.js）：存了內容、送交櫃台（沒填任何東西時來院原因也算內容），
      // 以及取消看診（只有來院原因的那筆退回候診後不留日誌）都要重新同步。
      if (['clinical', 'start', 'handoff', 'unstart'].includes(action)) await syncAppointmentJournal(appointment, { session });

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

      if (action === 'followup') ({ followUp, previousDate: followUpPreviousDate } = await bookFollowUp(appointment, req.body, { session }));
      // Even no-op commands advance the revision, so stale confirmations cannot succeed.
      appointment.increment();
      await appointment.save({ session });
    });
    // 櫃台完成處理＝離開診所：從 IDEXX 主機的在院清單收掉（伺服器有開才會排隊）。
    if (action === 'complete') await queueIdexxCensus(appointment);
    // 結案時排了自動寄送、在等櫃台的報告：現在可以寄了（勾了不寄就診紀錄的由寄送本身擋下）。
    if (action === 'complete') notifyDeskCompleted();
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
