import { workflowState } from '../../../shared/appointmentWorkflow.js';

export const WORKFLOW_ACTIONS = ['clinical', 'start', 'handoff', 'reclaim', 'complete', 'record', 'followup', 'request-reopen', 'approve-reopen'];

export function workflowError(message, status = 422) {
  return Object.assign(new Error(message), { status });
}

// 醫師寫給櫃台的自由文字。收費、領藥、要開的證明都寫在 handoffNote，
// 系統不再逐項計價，也不保存任何金額——櫃台讀這段文字自己收費。
const CLINICAL_TEXT_FIELDS = ['visitNote', 'handoffNote', 'specialCareNote', 'followUpRecommendation', 'followUpReason'];
const CLINICAL_FIELDS = [...CLINICAL_TEXT_FIELDS, 'weightKg', 'temperatureC'];

// 來院原因、「本次簡易紀錄」與當次量測需在病歷日誌中一同閱讀；也同步成
// 同一筆自動日誌，避免醫師日後只能看到文字卻缺少看診當下的體重／體溫。
export function appointmentJournalContent(appointment) {
  const reason = String(appointment.reason || '').trim();
  const measurements = [];
  if (appointment.weightKg !== null && appointment.weightKg !== undefined) measurements.push(`體重：${appointment.weightKg} kg`);
  if (appointment.temperatureC !== null && appointment.temperatureC !== undefined) measurements.push(`體溫：${appointment.temperatureC} °C`);
  return [reason ? `來院原因：${reason}` : '', measurements.join('　'), String(appointment.visitNote || '').trim()].filter(Boolean).join('\n\n');
}

export function assertWorkflowVersion(appointment, version) {
  if (!Number.isInteger(version) || version !== (appointment.__v ?? 0)) {
    throw workflowError('資料已更新，請載入最新內容後再確認；尚未儲存的輸入會保留。', 409);
  }
}

// 舊版（批價／收款）的掛號第一次被新流程碰到時，把里程碑對應過來。
// 不做資料庫層級的遷移：沒有人會再去操作已結案的舊掛號，這裡只保證它們一旦被開啟
// 就落在正確的階段，而不是倒退回候診。
export function adoptWorkflow(appointment) {
  if (appointment.workflowVersion === 2) return;
  const state = workflowState(appointment);
  const seenAt = appointment.completedAt || appointment.updatedAt || new Date();
  appointment.visitStartedAt ||= state.started ? (appointment.checkedInAt || seenAt) : null;
  appointment.handoffAt ||= state.handedOff ? seenAt : null;
  appointment.deskCompletedAt ||= state.completed ? (appointment.completedAt || seenAt) : null;
  appointment.workflowVersion = 2;
}

export function applyWorkflowAction(appointment, action, body, now = new Date()) {
  if (!['arrived', 'pending_checkout', 'completed'].includes(appointment.status) || !appointment.petId) {
    throw workflowError('請先完成報到，才能處理看診與交辦');
  }
  adoptWorkflow(appointment);
  const state = workflowState(appointment);

  if (action === 'clinical') {
    if (state.completed) throw workflowError('櫃台已完成這筆就診，不能再修改內容', 409);
    const requestedFields = CLINICAL_FIELDS.filter((field) => body[field] !== undefined);
    const onlyVisitNote = requestedFields.length > 0 && requestedFields.every((field) => field === 'visitNote');
    if (state.handedOff && !onlyVisitNote) throw workflowError('這筆就診已交給櫃台，請先取回再修改內容', 409);
    for (const field of CLINICAL_TEXT_FIELDS) {
      if (body[field] !== undefined) appointment[field] = String(body[field] ?? '').trim();
    }
    for (const field of ['weightKg', 'temperatureC']) {
      if (body[field] === undefined) continue;
      const value = body[field] === '' || body[field] === null ? null : Number(body[field]);
      if (value !== null && (!Number.isFinite(value) || value < 0)) throw workflowError('量測值必須是有效的非負數');
      appointment[field] = value;
    }
  } else if (action === 'start') {
    if (!state.handedOff) appointment.visitStartedAt ||= now;
  } else if (action === 'handoff') {
    if (state.handedOff) throw workflowError('這筆就診已交給櫃台', 409);
    appointment.visitStartedAt ||= now;
    appointment.handoffAt = now;
  } else if (action === 'reclaim') {
    // 取回：櫃台按下「完成處理」之前都可以，之後不行——那時號碼牌已歸還、就診已結案。
    if (state.completed) throw workflowError('櫃台已完成處理，這筆就診不能再取回', 409);
    if (!state.handedOff) throw workflowError('這筆就診還在看診中，不需要取回', 409);
    appointment.handoffAt = null;
  } else if (action === 'complete') {
    if (!state.handedOff) throw workflowError('請等醫師完成看診並送交櫃台', 409);
    if (state.completed) throw workflowError('這筆就診已完成處理', 409);
    appointment.deskCompletedAt = now;
  } else if (action === 'request-reopen') {
    if (!state.completed) throw workflowError('只有已完成的就診可以申請修改', 409);
    if (appointment.reopenRequest?.requestedAt && !appointment.reopenRequest.approvedAt) {
      throw workflowError('這筆就診已有待核准的修改申請', 409);
    }
    const reason = String(body.reason || '').trim();
    appointment.reopenRequest = { reason, requestedAt: now, approvedAt: null };
  } else if (action === 'approve-reopen') {
    if (!state.completed || !appointment.reopenRequest?.requestedAt) throw workflowError('目前沒有待核准的修改申請', 409);
    appointment.deskCompletedAt = null;
    appointment.completedAt = null;
    appointment.reopenRequest.approvedAt = now;
  } else if (!['followup', 'record'].includes(action)) {
    throw workflowError('不支援的診務操作');
  }

  const next = workflowState(appointment);
  appointment.status = next.completed ? 'completed' : next.handedOff ? 'pending_checkout' : 'arrived';
  if (appointment.status === 'completed') {
    appointment.completedAt ||= now;
    const history = Array.from(appointment.checkinNumberHistory || []);
    if (appointment.checkinNumber && !history.includes(appointment.checkinNumber)) history.push(appointment.checkinNumber);
    appointment.checkinNumberHistory = history;
    appointment.checkinNumber = null;
  }
}
