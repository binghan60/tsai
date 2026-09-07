// Legacy status remains a summary for existing dashboards; these milestones are independent.
export function workflowState(appointment = {}) {
  const legacy = appointment.workflowVersion !== 1;
  const wasSeen = legacy && ['pending_checkout', 'completed'].includes(appointment.status);
  return {
    started: Boolean(appointment.visitStartedAt || wasSeen),
    visited: Boolean(appointment.visitCompletedAt || wasSeen),
    billed: Boolean(appointment.billingCompletedAt || wasSeen),
    paid: Boolean(appointment.paymentCompletedAt || (legacy && appointment.status === 'completed')),
  };
}

export function workflowFilter(appointment, filter) {
  const state = workflowState(appointment);
  const active = ['arrived', 'pending_checkout', 'completed'].includes(appointment.status);
  switch (filter) {
    case 'waiting': return active && !state.started && !state.visited;
    case 'visiting': return active && state.started && !state.visited;
    case 'billing': return active && !state.billed;
    case 'payment': return active && state.billed && !state.paid;
    case 'followup': return active && Boolean(appointment.followUpRecommendation || appointment.followUpReason) && !appointment.followUpAppointmentId;
    case 'scheduled': return appointment.status === 'scheduled';
    case 'completed': return state.visited && state.paid;
    case 'cancelled': return ['cancelled', 'no_show'].includes(appointment.status);
    default: return true;
  }
}

export function visitLabel(appointment) {
  if (appointment.status === 'cancelled') return '已取消';
  if (appointment.status === 'no_show') return '未到';
  if (appointment.status === 'scheduled') return '待報到';
  const state = workflowState(appointment);
  return state.visited ? '看診完成' : state.started ? '看診中' : '候診中';
}
