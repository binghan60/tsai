import { formatDate } from './datetime.js';

export function appointmentSubject(appointment) {
  const name = String(appointment.petName ?? '').trim();
  return name ? `「${name}」` : '未填姓名的病患';
}

export function appointmentNotification(appointment, action, { changedParts = [] } = {}) {
  const subject = appointmentSubject(appointment);
  const messages = {
    create: `已為${subject}新增掛號`,
    check_in: `${subject}已報到`,
    card_number: `${subject}的號碼牌已改為 ${appointment.checkinNumber} 號`,
    complete: `${subject}已完成看診`,
    visit_data: `${subject}的${changedParts.join('、') || '看診資料'}已更新`,
    edit: `${subject}的掛號資料已更新`,
    cancel: `${subject}的掛號已取消${appointment.cancelReason ? `（原因：${appointment.cancelReason}）` : ''}`,
    no_show: `${subject}已標記為未到診`,
    restore: `${subject}的掛號已恢復，等待報到`,
    undo_check_in: `${subject}的報到已取消，恢復為待報到`,
    delete: `${subject}的掛號已永久刪除`,
  };
  if (!messages[action]) throw new Error(`Unknown appointment notification: ${action}`);
  return `${messages[action]}（掛號：${formatDate(appointment.date)} ${appointment.time || '未指定時間'}）`;
}

const NUMBER_FIELDS = new Set(['weightKg', 'temperatureC']);
function normalizedValue(key, value) {
  if (NUMBER_FIELDS.has(key)) return value == null || String(value).trim() === '' ? null : Number(value);
  return String(value ?? '').trim();
}

export function changedAppointmentFields(before, after, fields) {
  return fields.filter((key) => !Object.is(normalizedValue(key, before[key]), normalizedValue(key, after[key])));
}

export function describeVisitChanges(before, after) {
  return [
    ['看診備註', ['visitNote']],
    ['量測資料', ['weightKg', 'temperatureC']],
    ['回診資料', ['followUpDate', 'followUpTime', 'followUpReason']],
  ].filter(([, fields]) => changedAppointmentFields(before, after, fields).length).map(([label]) => label);
}
