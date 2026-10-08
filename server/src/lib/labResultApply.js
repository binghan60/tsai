import Appointment from '../models/Appointment.js';
import FormTemplate from '../models/FormTemplate.js';
import LabResult from '../models/LabResult.js';
import Pet from '../models/Pet.js';
import { templateLabItems } from '../../../shared/labValues.js';
import { mergeLabValues } from './appointmentWorkflow.js';
import { syncAppointmentJournal } from './appointmentJournal.js';
import { clinicToday } from './clinicTime.js';
import { liveConflicts, matchLabItem, overwriteValues, petIdFromPatientId, pickVisit, planLabFill, planUndo } from './labResultFill.js';
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
// appointmentId：醫師在診療台「匯入檢驗結果」指定要填進哪一次看診——不限檢驗當天（昨天驗、今天回來看報告）。
// 指定了就不再自己找看診；就算那次看診沒選健檢表單、填不進去，也記下關聯，診療台的檢驗報告才顯示得出這一份。
export async function applyLabResult(labResultId, { force = false, appointmentId = null } = {}) {
  const result = await LabResult.findById(labResultId).lean();
  if (!result?.petId) return { status: 'unmatched' };
  if (result.appliedAt && !force) return { status: 'already_applied' };

  let visit;
  if (appointmentId) {
    visit = await Appointment.findOne({ _id: appointmentId, petId: result.petId }).select('_id status checkedInAt templateId').lean();
    if (!visit) throw Object.assign(new Error('這次看診不是這隻貓咪的'), { status: 422 });
    if (!visit.templateId) {
      await LabResult.updateOne({ _id: result._id }, { $set: { appointmentId: visit._id } });
      // 數值填不進看診，但這份結果要出現在這次看診的病歷日誌上。
      await syncAppointmentJournal(await Appointment.findById(visit._id));
      return { status: 'no_template', appointmentId: visit._id };
    }
  } else {
    const date = clinicToday(result.runAt ?? result.createdAt);
    const visits = await Appointment.find({ petId: result.petId, date }).select('_id status checkedInAt templateId').lean();
    visit = pickVisit(visits, result.runAt);
    if (!visit) return { status: 'no_visit', date };
    if (!visit.templateId) return { status: 'no_template', appointmentId: visit._id };
  }

  let plan = null;
  let changed = null;
  await withTransaction(async (session) => {
    changed = null;
    const appointment = await Appointment.findById(visit._id).session(session);
    const template = await FormTemplate.findById(appointment.templateId).session(session);
    const labItems = templateLabItems(template);
    plan = planLabFill(result.assays, labItems, appointment.labValues, result.instrument);
    const labels = new Map(labItems.map((item) => [item.key, item.label]));
    plan.filled = Object.entries(plan.fill).map(([key, value]) => ({ key, label: labels.get(key) ?? key, value }));
    if (plan.filled.length) {
      appointment.labValues = mergeLabValues(appointment.labValues, plan.fill, labItems);
      appointment.increment();
      await appointment.save({ session });
      changed = appointment;
    }
    await LabResult.updateOne(
      { _id: result._id },
      {
        $set: {
          appointmentId: appointment._id,
          appliedAt: new Date(),
          filled: plan.filled,
          conflicts: plan.conflicts,
          conflictsOpen: plan.conflicts.length > 0,
          conflictsResolvedAt: null,
          unmappedCodes: plan.unmapped,
        },
      },
      { session }
    );
    // 這份結果連上看診之後才同步：日誌的「IDEXX 檢驗」那一段讀的是連到這次看診的結果，
    // 就算一格都沒填進去（表單沒設代號）也要有日誌。
    await syncAppointmentJournal(appointment, { session });
  });
  // 診療台、掛號台開著的畫面即時更新；transaction 成功之後才廣播。
  if (changed) emitAppointmentUpdate(changed);
  return {
    status: 'applied',
    appointmentId: visit._id,
    filled: plan.filled.map((entry) => entry.label),
    conflicts: plan.conflicts.length,
    unmapped: plan.unmapped.length,
    unmappedCodes: plan.unmapped,
  };
}

// 待確認清單裡人選了是哪隻貓。已經配對或忽略的不能再選（別台剛處理掉）。
// appointmentId（選填）：指定要填進哪一次看診（診療台的匯入）；沒給就照檢驗當天找。
export async function matchManually(labResultId, petId, { appointmentId = null } = {}) {
  if (!(await Pet.exists({ _id: petId }))) throw Object.assign(new Error('找不到這隻貓咪'), { status: 404 });
  if (appointmentId && !(await Appointment.exists({ _id: appointmentId, petId }))) {
    throw Object.assign(new Error('這次看診不是這隻貓咪的'), { status: 422 });
  }
  const updated = await LabResult.findOneAndUpdate(
    { _id: labResultId, petId: null, dismissedAt: null },
    { $set: { petId, matchedAt: new Date(), matchSource: 'manual' } },
    { new: true }
  );
  if (!updated) throw Object.assign(new Error('這份檢驗結果已經被處理了，請重新整理'), { status: 409 });
  return applyLabResult(labResultId, { appointmentId });
}

// 復原（選錯貓）：清掉這份結果填進看診、而且還沒被人改過的數值，結果回到待確認清單。
export async function unmatchLabResult(labResultId) {
  let undo = { clear: [], kept: [] };
  let changed = null;
  await withTransaction(async (session) => {
    changed = null;
    undo = { clear: [], kept: [] };
    let appointment = null;
    const result = await LabResult.findById(labResultId).session(session);
    if (!result) throw Object.assign(new Error('找不到檢驗結果'), { status: 404 });
    if (!result.petId) throw Object.assign(new Error('這份檢驗結果還沒有配對'), { status: 409 });
    if (result.appointmentId) {
      appointment = await Appointment.findById(result.appointmentId).session(session);
      if (appointment) {
        undo = planUndo(appointment.labValues, result.filled);
        if (undo.clear.length) {
          const clear = new Set(undo.clear);
          appointment.labValues = appointment.labValues.filter((lab) => !clear.has(lab.key));
          appointment.increment();
          await appointment.save({ session });
          changed = appointment;
        }
      }
    }
    Object.assign(result, {
      petId: null, matchedAt: null, matchSource: null, appointmentId: null,
      appliedAt: null, filled: [], conflicts: [], conflictsOpen: false, conflictsResolvedAt: null, unmappedCodes: [], overrides: [],
    });
    await result.save({ session });
    // 解除連結之後才同步：這份結果不再出現在那次看診的日誌上，日誌因此沒內容就一併拿掉。
    if (appointment) await syncAppointmentJournal(appointment, { session });
  });
  if (changed) emitAppointmentUpdate(changed);
  return { cleared: undo.clear.length, kept: undo.kept };
}

// 病歷日誌上修改 IDEXX 數值：values 是 { 代號: 新值 }，空白或改回原始值＝還原。
// 儀器原文（assays）不動，改的記在 overrides；顯示與日誌用改後的值、標「已修改」。
// 這個代號當初填進看診的檢驗數值、而且那一格還是原本填的值，就一起換成新的——不然日誌上改了、健檢報告還是舊的。
const OVERRIDE_MAX = 40;
export async function editLabResultValues(labResultId, values) {
  const invalid = (message, status = 422) => Object.assign(new Error(message), { status });
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw invalid('檢驗數值格式不正確');
  let changed = null;
  let count = 0;
  await withTransaction(async (session) => {
    changed = null;
    count = 0;
    const result = await LabResult.findById(labResultId).session(session);
    if (!result) throw invalid('找不到檢驗結果', 404);
    if (!result.petId) throw invalid('這份檢驗結果還沒有確認是哪隻貓咪', 409);
    const original = new Map(result.assays.map((assay) => [assay.code, String(assay.value ?? '')]));
    const overrides = new Map((result.overrides ?? []).map((entry) => [entry.code, entry.value]));
    const moved = [];
    for (const [code, raw] of Object.entries(values)) {
      if (!original.has(code)) throw invalid('檢驗項目不在這份結果裡');
      if (raw !== null && typeof raw !== 'string' && typeof raw !== 'number') throw invalid('檢驗數值格式不正確');
      const value = String(raw ?? '').trim();
      if (value.length > OVERRIDE_MAX) throw invalid(`檢驗數值過長（最多 ${OVERRIDE_MAX} 字）`);
      const before = overrides.has(code) ? overrides.get(code) : original.get(code);
      if (!value || value === original.get(code)) overrides.delete(code);
      else overrides.set(code, value);
      const after = overrides.has(code) ? overrides.get(code) : original.get(code);
      if (after !== before) moved.push({ code, before, after });
    }
    if (!moved.length) return;
    count = moved.length;
    result.overrides = [...overrides].map(([code, value]) => ({ code, value }));

    const appointment = result.appointmentId ? await Appointment.findById(result.appointmentId).session(session) : null;
    if (appointment?.templateId) {
      const template = await FormTemplate.findById(appointment.templateId).session(session);
      const labItems = templateLabItems(template);
      const current = new Map((appointment.labValues ?? []).map((lab) => [lab.key, String(lab.value ?? '')]));
      const follow = {};
      for (const { code, before, after } of moved) {
        const key = matchLabItem(labItems, result.instrument, code)?.key;
        if (key && current.get(key) === before) follow[key] = after;
      }
      if (Object.keys(follow).length) {
        appointment.labValues = mergeLabValues(appointment.labValues, follow, labItems);
        appointment.increment();
        await appointment.save({ session });
        changed = appointment;
        result.filled = (result.filled ?? []).map((entry) => ({ key: entry.key, label: entry.label, value: entry.key in follow ? follow[entry.key] : entry.value }));
      }
    }
    await result.save({ session });
    if (appointment) await syncAppointmentJournal(appointment, { session });
  });
  if (changed) emitAppointmentUpdate(changed);
  return { changed: count };
}

// 還沒處理的數值差異，用報告上現在的值重新比過。appointmentId 有值時只看那次看診（健檢報告打開時）。
// 比完已經沒有差異的（醫師自己改成一樣了）順手關掉，免得「檢驗」面板一直掛著空的一筆。
export async function openConflicts({ appointmentId = null } = {}) {
  const filter = { conflictsOpen: true, ...(appointmentId ? { appointmentId } : {}) };
  const results = await LabResult.find(filter).sort({ runAt: -1, _id: -1 }).select('_id instrument runAt petId appointmentId conflicts').lean();
  if (!results.length) return [];
  const visits = await Appointment.find({ _id: { $in: results.map((result) => result.appointmentId) } })
    .select('_id petName date labValues').lean();
  const visitById = new Map(visits.map((visit) => [String(visit._id), visit]));
  const groups = [];
  const stale = [];
  for (const result of results) {
    const visit = visitById.get(String(result.appointmentId));
    const items = visit ? liveConflicts(result.conflicts, visit.labValues) : [];
    if (!items.length) {
      stale.push(result._id);
      continue;
    }
    groups.push({
      id: result._id, instrument: result.instrument, runAt: result.runAt,
      petId: result.petId, petName: visit.petName, appointmentId: result.appointmentId, visitDate: visit.date, items,
    });
  }
  if (stale.length) await LabResult.updateMany({ _id: { $in: stale } }, { $set: { conflictsOpen: false, conflictsResolvedAt: new Date() } });
  return groups;
}

// 比對視窗按下去：勾選的欄位換成 IDEXX 的值（「都不要」就是空陣列），這份結果的差異就算處理完。
export async function resolveConflicts(labResultId, keys) {
  let overwritten = [];
  let changed = null;
  await withTransaction(async (session) => {
    overwritten = [];
    changed = null;
    const result = await LabResult.findById(labResultId).session(session);
    if (!result) throw Object.assign(new Error('找不到檢驗結果'), { status: 404 });
    if (!result.conflictsOpen) throw Object.assign(new Error('這份檢驗結果的差異已經處理過了'), { status: 409 });
    const appointment = result.appointmentId ? await Appointment.findById(result.appointmentId).session(session) : null;
    if (appointment) {
      const template = appointment.templateId ? await FormTemplate.findById(appointment.templateId).session(session) : null;
      const labItems = templateLabItems(template);
      // 表單後來拿掉的項目寫不進去（mergeLabValues 只收表單裡有的），就不覆蓋。
      const allowed = new Set(labItems.map((item) => item.key));
      const values = Object.fromEntries(Object.entries(overwriteValues(result.conflicts, keys)).filter(([key]) => allowed.has(key)));
      overwritten = Object.keys(values);
      if (overwritten.length) {
        appointment.labValues = mergeLabValues(appointment.labValues, values, labItems);
        appointment.increment();
        await appointment.save({ session });
        await syncAppointmentJournal(appointment, { session });
        changed = appointment;
      }
    }
    result.conflictsOpen = false;
    result.conflictsResolvedAt = new Date();
    await result.save({ session });
  });
  if (changed) emitAppointmentUpdate(changed);
  return { overwritten };
}

// 忽略：品管測試、練習用的檢驗。只有還在待確認清單上的能忽略。
export async function dismissLabResult(labResultId) {
  const updated = await LabResult.findOneAndUpdate(
    { _id: labResultId, petId: null, dismissedAt: null },
    { $set: { dismissedAt: new Date() } },
    { new: true }
  );
  if (!updated) throw Object.assign(new Error('這份檢驗結果已經被處理了，請重新整理'), { status: 409 });
}
