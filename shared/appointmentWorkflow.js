// 一條看診流水線：預約 → 候診 → 看診 → 櫃台完成，由三個里程碑時間戳記決定走到哪一步。
// status 仍然存在（清單、索引與號碼牌邏輯都依賴它），但它是這三個里程碑推導出來的摘要，
// 不是另一個獨立的真相；推導在 server/src/lib/appointmentWorkflow.js 的 applyWorkflowAction 尾端。
export function workflowState(appointment = {}) {
  return {
    started: Boolean(appointment.visitStartedAt),
    handedOff: Boolean(appointment.handoffAt),
    completed: Boolean(appointment.deskCompletedAt),
  };
}

// 每一個篩選鍵就是流水線上的一段，掛號在任一時刻只落在其中一格。依 status 分（總覽的數字也是），
// 只有候診與看診中要再看 visitStartedAt。
// 醫師端用 waiting／visiting／handoff／completed，櫃台端用 scheduled／onsite／handoff／followup／completed。
export function workflowFilter(appointment, filter) {
  const { status } = appointment;
  switch (filter) {
    case 'waiting': return status === 'arrived' && !appointment.visitStartedAt;
    case 'visiting': return status === 'arrived' && Boolean(appointment.visitStartedAt);
    // 在院＝候診＋看診中，櫃台只需要知道「這個人還在裡面」。
    case 'onsite': return status === 'arrived';
    case 'handoff': return status === 'pending_checkout';
    // 待安排回診：醫師寫了回診建議，櫃台還沒掛下一次的號。
    case 'followup': return ['arrived', 'pending_checkout', 'completed'].includes(status)
      && Boolean(appointment.followUpRecommendation) && !appointment.followUpAppointmentId;
    case 'scheduled': return status === 'scheduled';
    case 'completed': return status === 'completed';
    case 'cancelled': return status === 'cancelled' || status === 'no_show';
    default: return true;
  }
}
