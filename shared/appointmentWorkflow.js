// 一條看診流水線：預約 → 候診 → 看診 → 櫃台完成，只有三個里程碑時間戳記。
// status 仍然存在（既有清單、索引與號碼牌邏輯都依賴它），但它是這三個里程碑推導出來的摘要，
// 不是另一個獨立的真相；推導在 server/src/lib/appointmentWorkflow.js 的 applyWorkflowAction 尾端。
//
// workflowVersion 2 是這條流水線；1 是舊的「批價／收款」版本，0 是更早只有 status 的版本。
// 舊資料沒有 handoffAt/deskCompletedAt，也不做資料庫遷移——舊版的批價欄位已經從 schema 移除，
// 讀不回來了，所以改由 status 回推：舊版的 pending_checkout 就是「醫師看完交出去了」，
// completed 就是「櫃台處理完了」。已結案的舊掛號不會再被操作，回推只是要讓清單顯示正確的階段。
export function workflowState(appointment = {}) {
  const legacy = appointment.workflowVersion !== 2;
  const legacySeen = legacy && ['pending_checkout', 'completed'].includes(appointment.status);
  return {
    started: Boolean(appointment.visitStartedAt) || legacySeen,
    handedOff: Boolean(appointment.handoffAt) || legacySeen,
    completed: Boolean(appointment.deskCompletedAt) || (legacy && appointment.status === 'completed'),
  };
}

// 每一個篩選鍵就是流水線上的一段，掛號在任一時刻只落在其中一格。
// 醫師端用 waiting／visiting／handoff／completed，櫃台端用 scheduled／onsite／handoff／followup／completed。
export function workflowFilter(appointment, filter) {
  const state = workflowState(appointment);
  const active = ['arrived', 'pending_checkout', 'completed'].includes(appointment.status);
  switch (filter) {
    case 'waiting': return active && !state.started && !state.handedOff;
    case 'visiting': return active && state.started && !state.handedOff;
    // 在院中＝候診中＋看診中，櫃台只需要知道「這個人還在裡面」。
    case 'onsite': return active && !state.handedOff;
    case 'handoff': return active && state.handedOff && !state.completed;
    case 'followup': return active
      && Boolean(appointment.followUpRecommendation || appointment.followUpReason)
      && !appointment.followUpAppointmentId;
    case 'scheduled': return appointment.status === 'scheduled';
    case 'completed': return state.completed;
    case 'cancelled': return ['cancelled', 'no_show'].includes(appointment.status);
    default: return true;
  }
}

export function visitLabel(appointment) {
  if (appointment.status === 'cancelled') return '已取消';
  if (appointment.status === 'no_show') return '未到';
  if (appointment.status === 'scheduled') return '待報到';
  const state = workflowState(appointment);
  if (state.completed) return '已完成';
  if (state.handedOff) return '已交櫃台';
  return state.started ? '看診中' : '候診中';
}
