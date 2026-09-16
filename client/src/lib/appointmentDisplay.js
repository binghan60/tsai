import { workflowState } from '../../../shared/appointmentWorkflow.js';

// 櫃台工作台與醫師診療台共用的顯示文字與階段判斷。
// 之前兩頁（加上看診工作區）各寫一份，初診／回診、遲到的文案與號碼牌顏色因此各走各的。

export function visitTypeLabel(appointment = {}) {
  if (appointment.visitType === 'new') return '初診';
  if (appointment.visitType === 'return') return '回診';
  return '';
}

export function latenessLabel(minutes) {
  const value = Math.floor(Number(minutes) || 0);
  return value >= 1 ? `遲到 ${value} 分` : '';
}

// 寵物／飼主備註（「會咬人」「飼主難溝通」）。資料來自 GET /api/appointments 的 patientNotes，
// 以 id 為鍵，不在掛號快照上；初診還沒建檔時沒有 id，自然沒有備註。
export function patientNotesFor(appointment = {}, patientNotes = {}) {
  return [
    { key: 'pet', label: '寵物', text: appointment.petId ? patientNotes.pets?.[String(appointment.petId)] : '' },
    { key: 'owner', label: '飼主', text: appointment.ownerId ? patientNotes.owners?.[String(appointment.ownerId)] : '' },
  ].filter((note) => note.text);
}

// 號碼牌圓圈的階段：候診 → 看診中 → 待櫃台 → 已完成。
export function checkinTone(appointment = {}) {
  const state = workflowState(appointment);
  if (state.completed) return 'done';
  if (state.handedOff) return 'handoff';
  if (state.started) return 'visiting';
  return 'waiting';
}
