import { workflowState } from '../../../shared/appointmentWorkflow.js';
import { sanitizeBillingItems, calculateBillingSubtotal } from './appointmentBilling.js';

export function workflowError(message, status = 422) {
  return Object.assign(new Error(message), { status });
}

export function assertWorkflowVersion(appointment, version) {
  if (!Number.isInteger(version) || version !== (appointment.__v ?? 0)) {
    throw workflowError('資料已更新，請載入最新內容後再確認；尚未儲存的輸入會保留。', 409);
  }
}

export function adoptWorkflow(appointment) {
  if (appointment.workflowVersion === 1) return;
  const state = workflowState(appointment);
  const seenAt = appointment.pendingCheckoutAt || appointment.completedAt || appointment.updatedAt || new Date();
  appointment.visitStartedAt ||= state.started ? (appointment.checkedInAt || seenAt) : null;
  appointment.visitCompletedAt ||= state.visited ? seenAt : null;
  appointment.billingCompletedAt ||= state.billed ? seenAt : null;
  appointment.paymentCompletedAt ||= state.paid ? (appointment.completedAt || seenAt) : null;
  appointment.billingRevision ||= state.billed ? 1 : 0;
  appointment.workflowVersion = 1;
}

export function applyWorkflowAction(appointment, action, body, now = new Date()) {
  if (!['arrived', 'pending_checkout', 'completed'].includes(appointment.status) || !appointment.petId) {
    throw workflowError('請先完成報到，才能處理看診與收款');
  }
  adoptWorkflow(appointment);
  const state = workflowState(appointment);
  if (action === 'clinical') {
    for (const field of ['visitNote', 'handoffNote', 'specialCareNote', 'followUpRecommendation', 'followUpReason']) {
      if (body[field] !== undefined) appointment[field] = String(body[field] ?? '').trim();
    }
    for (const field of ['weightKg', 'temperatureC']) {
      if (body[field] === undefined) continue;
      const value = body[field] === '' || body[field] === null ? null : Number(body[field]);
      if (value !== null && (!Number.isFinite(value) || value < 0)) throw workflowError('量測值必須是有效的非負數');
      appointment[field] = value;
    }
    if (body.billingItems !== undefined) {
      if (state.billed || state.paid) throw workflowError('批價已確認，請先撤回批價後再修改處方與費用', 409);
      if (!Array.isArray(body.billingItems)) throw workflowError('費用明細格式不正確');
      for (const item of body.billingItems) {
        if (!String(item?.name ?? '').trim()) throw workflowError('請填寫每筆費用或藥品名稱');
        for (const field of ['quantity', 'unitPrice', 'amount']) {
          if (item[field] !== undefined && item[field] !== '' && (!Number.isFinite(Number(item[field])) || Number(item[field]) < 0)) {
            throw workflowError('費用、單價與數量必須是有效的非負數');
          }
        }
      }
      appointment.billingItems = sanitizeBillingItems(body.billingItems);
      appointment.billingSubtotal = calculateBillingSubtotal(appointment.billingItems);
    }
  } else if (action === 'start') {
    if (!state.visited) appointment.visitStartedAt ||= now;
  } else if (action === 'bill') {
    if (state.billed) throw workflowError('這筆就診已完成批價', 409);
    appointment.billingCompletedAt = now;
    appointment.pendingCheckoutAt = now;
    appointment.billingRevision = (appointment.billingRevision || 0) + 1;
  } else if (action === 'unbill') {
    if (state.paid) throw workflowError('已收款的批價不可撤回，請另行處理補收或退款', 409);
    appointment.billingCompletedAt = null;
    appointment.pendingCheckoutAt = null;
    appointment.billingRevision = (appointment.billingRevision || 0) + 1;
  } else if (action === 'finish') {
    appointment.visitStartedAt ||= now;
    appointment.visitCompletedAt ||= now;
  } else if (action === 'pay') {
    if (!state.billed || state.paid) throw workflowError(state.paid ? '這筆就診已收款，請勿重複收款' : '請等候醫師完成批價', 409);
    if (body.billingRevision !== appointment.billingRevision) throw workflowError('批價已異動，請重新核對金額', 409);
    const total = body.checkoutTotal === undefined ? appointment.billingSubtotal : Number(body.checkoutTotal);
    if (body.checkoutTotal === '' || body.checkoutTotal === null || !Number.isFinite(total) || total < 0) throw workflowError('請輸入有效的實收金額');
    if (!['cash', 'card', 'transfer'].includes(body.paymentMethod)) throw workflowError('請選擇付款方式');
    const adjustment = String(body.checkoutAdjustmentNote || '').trim();
    if (total !== appointment.billingSubtotal && !adjustment) throw workflowError('實收金額與批價不同，請填寫調整原因');
    appointment.checkoutTotal = total;
    appointment.checkoutAdjustmentNote = adjustment;
    appointment.paymentMethod = body.paymentMethod;
    appointment.paymentCompletedAt = now;
  } else if (action === 'handoff') {
    appointment.handoffAcknowledgedAt = body.acknowledged ? now : null;
  } else if (!['followup', 'record'].includes(action)) {
    throw workflowError('不支援的診務操作');
  }
  if (action === 'clinical' && ['handoffNote', 'specialCareNote', 'followUpRecommendation', 'followUpReason'].some(key => body[key] !== undefined)) {
    appointment.handoffAcknowledgedAt = null;
  }
  const next = workflowState(appointment);
  appointment.status = next.visited && next.paid ? 'completed' : next.billed ? 'pending_checkout' : 'arrived';
  if (appointment.status === 'completed') {
    appointment.completedAt ||= now;
    const history = Array.from(appointment.checkinNumberHistory || []);
    if (appointment.checkinNumber && !history.includes(appointment.checkinNumber)) history.push(appointment.checkinNumber);
    appointment.checkinNumberHistory = history;
    appointment.checkinNumber = null;
  }
}
