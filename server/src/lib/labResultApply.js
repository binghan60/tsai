import Appointment from '../models/Appointment.js';
import FormTemplate from '../models/FormTemplate.js';
import LabResult from '../models/LabResult.js';
import Pet from '../models/Pet.js';
import { templateLabItems } from '../../../shared/labValues.js';
import { mergeLabValues } from './appointmentWorkflow.js';
import { syncAppointmentJournal } from './appointmentJournal.js';
import { clinicToday } from './clinicTime.js';
import { petIdFromPatientId, pickVisit, planLabFill } from './labResultFill.js';
import { emitAppointmentUpdate } from './realtime.js';
import { withTransaction } from './transaction.js';

// IDEXX 檢驗結果自動填進看診（規則見 lib/labResultFill.js，這裡負責讀寫資料庫）。

// 上傳後自動認貓：IDEXX 帶回報到時送出的貓咪編號、而且這隻貓真的存在。已經配對過的不動。
export async function matchByPatientId(labResultId, patientId) {
  const petId = petIdFromPatientId(patientId);
  if (!petId || !(await Pet.exists({ _id: petId }))) return null;
  const updated = await LabResult.findOneAndUpdate(
    { _id: labResultId, petId: null },
    { $set: { petId, matchedAt: new Date(), matchSource: 'patient_id' } },
    { new: true }
  );
  return updated?.petId ?? null;
}

// 把已經知道是哪隻貓的結果，填進那隻貓檢驗當天的看診。
// 找不到看診、看診沒選健檢表單時不記 appliedAt——之後掛號補上或重送檔案時還能再套用一次。
// force：IDEXX 送了更正版，要重新比一次；平常已經填過的就不重填。
export async function applyLabResult(labResultId, { force = false } = {}) {
  const result = await LabResult.findById(labResultId).lean();
  if (!result?.petId) return { status: 'unmatched' };
  if (result.appliedAt && !force) return { status: 'already_applied' };

  const date = clinicToday(result.runAt ?? result.createdAt);
  const visits = await Appointment.find({ petId: result.petId, date }).select('_id status checkedInAt templateId').lean();
  const visit = pickVisit(visits, result.runAt);
  if (!visit) return { status: 'no_visit', date };
  if (!visit.templateId) return { status: 'no_template', appointmentId: visit._id };

  let plan = null;
  let changed = null;
  await withTransaction(async (session) => {
    changed = null;
    const appointment = await Appointment.findById(visit._id).session(session);
    const template = await FormTemplate.findById(appointment.templateId).session(session);
    const labItems = templateLabItems(template);
    plan = planLabFill(result.assays, labItems, appointment.labValues);
    if (Object.keys(plan.fill).length) {
      appointment.labValues = mergeLabValues(appointment.labValues, plan.fill, labItems);
      appointment.increment();
      await appointment.save({ session });
      // 檢驗數值會出現在病歷日誌的「檢驗」那一行，跟報告上改檢驗值一樣要同步。
      await syncAppointmentJournal(appointment, { session });
      changed = appointment;
    }
    await LabResult.updateOne(
      { _id: result._id },
      {
        $set: {
          appointmentId: appointment._id,
          appliedAt: new Date(),
          filledKeys: Object.keys(plan.fill),
          conflicts: plan.conflicts,
          unmappedCodes: plan.unmapped,
        },
      },
      { session }
    );
  });
  // 診療台、掛號台開著的畫面即時更新；transaction 成功之後才廣播。
  if (changed) emitAppointmentUpdate(changed);
  return {
    status: 'applied',
    appointmentId: visit._id,
    filled: Object.keys(plan.fill),
    conflicts: plan.conflicts.length,
    unmapped: plan.unmapped.length,
  };
}
