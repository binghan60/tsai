import { workflowState } from '../../../shared/appointmentWorkflow.js';

export const WORKFLOW_ACTIONS = ['clinical', 'start', 'handoff', 'reclaim', 'complete', 'record', 'followup', 'request-reopen', 'approve-reopen'];

export function workflowError(message, status = 422) {
  return Object.assign(new Error(message), { status });
}

// 醫師寫給櫃台的自由文字。收費、領藥、要開的證明都寫在 handoffNote，
// 系統不再逐項計價，也不保存任何金額——櫃台讀這段文字自己收費。
const CLINICAL_TEXT_FIELDS = ['visitNote', 'internalNote', 'handoffNote', 'specialCareNote', 'followUpRecommendation', 'followUpReason'];
const CLINICAL_FIELDS = [...CLINICAL_TEXT_FIELDS, 'weightKg', 'temperatureC'];

// 來院原因、「本次簡易紀錄」、給飼主的照護提醒、回診建議與當次量測需在病歷日誌中一同閱讀；
// 也同步成同一筆自動日誌，避免醫師日後只能看到本次簡易紀錄卻缺少看診當下交辦飼主的內容。
// internalNote 刻意不放進來——那是僅院內人員可見的備註，不該進入病歷日誌。
// 回傳分欄的段落（空的不回），前端依 key 分段呈現；純文字版 appointmentJournalContent 由它串成。
export function appointmentJournalSections(appointment) {
  const text = value => String(value ?? '').trim();
  const measured = value => value !== null && value !== undefined;
  return [
    { key: 'reason', label: '來院原因', text: text(appointment.reason) },
    { key: 'weightKg', label: '體重', text: measured(appointment.weightKg) ? `${appointment.weightKg} kg` : '' },
    { key: 'temperatureC', label: '體溫', text: measured(appointment.temperatureC) ? `${appointment.temperatureC} °C` : '' },
    { key: 'visitNote', label: '本次簡易紀錄', text: text(appointment.visitNote) },
    { key: 'specialCareNote', label: '請轉告飼主', text: text(appointment.specialCareNote) },
    { key: 'followUpRecommendation', label: '回診建議', text: text(appointment.followUpRecommendation) },
  ].filter(section => section.text);
}

// 純文字版：量測併成一行，本次簡易紀錄不帶標籤，其餘段落帶「標籤：」前綴。
export function appointmentJournalContent(appointment) {
  const byKey = new Map(appointmentJournalSections(appointment).map(section => [section.key, section]));
  const labelled = key => (byKey.has(key) ? `${byKey.get(key).label}：${byKey.get(key).text}` : '');
  return [
    labelled('reason'),
    [labelled('weightKg'), labelled('temperatureC')].filter(Boolean).join('　'),
    byKey.get('visitNote')?.text || '',
    labelled('specialCareNote'),
    labelled('followUpRecommendation'),
  ].filter(Boolean).join('\n\n');
}

// 日誌編輯表單要的原始值（量測是數字，不是「4.2 kg」這種顯示字串）。
export const APPOINTMENT_JOURNAL_FIELDS = ['reason', 'weightKg', 'temperatureC', 'visitNote', 'specialCareNote', 'followUpRecommendation'];
const JOURNAL_TEXT_LIMITS = { reason: 500, visitNote: 10000, specialCareNote: 500, followUpRecommendation: 500 };

export function appointmentJournalFields(appointment) {
  return Object.fromEntries(APPOINTMENT_JOURNAL_FIELDS.map(key => [key, appointment[key] ?? (key === 'weightKg' || key === 'temperatureC' ? null : '')]));
}

// 從病歷日誌直接改這次就診的內容。跟 workflow 的 clinical 不同，這裡**不看流程階段**：
// 病歷日誌是事後回頭更正紀錄的地方，櫃台完成處理之後照樣要改得動（看診工作區那邊仍然鎖著）。
// 只收日誌看得到的欄位，internalNote／handoffNote 不在這裡改。
export function applyJournalFields(appointment, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw workflowError('日誌欄位格式不正確');
  for (const [key, max] of Object.entries(JOURNAL_TEXT_LIMITS)) {
    if (body[key] === undefined) continue;
    if (body[key] !== null && typeof body[key] !== 'string') throw workflowError('日誌欄位格式不正確');
    const text = String(body[key] ?? '').trim();
    if (text.length > max) throw workflowError(`內容過長（最多 ${max} 字）`);
    appointment[key] = text;
  }
  for (const key of ['weightKg', 'temperatureC']) {
    if (body[key] === undefined) continue;
    const value = body[key] === '' || body[key] === null ? null : Number(body[key]);
    if (value !== null && (!Number.isFinite(value) || value < 0)) throw workflowError('量測值必須是有效的非負數');
    appointment[key] = value;
  }
  if (!appointmentJournalSections(appointment).length) throw workflowError('日誌內容不能全部清空');
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
    const onlyJournalFields = requestedFields.length > 0 && requestedFields.every((field) => ['visitNote', 'internalNote'].includes(field));
    if (state.handedOff && !onlyJournalFields) throw workflowError('這筆就診已交給櫃台，請先取回再修改內容', 409);
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
