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
    send_to_checkout: `${subject}已完成問診，待櫃台結帳${appointment.billingSubtotal ? `（建議金額 NT$${appointment.billingSubtotal}）` : ''}`,
    checkout_complete: `${subject}已完成結帳並看診結束${appointment.checkoutTotal != null ? `（結算 NT$${appointment.checkoutTotal}）` : ''}`,
    reopen_visit: `${subject}的結帳已退回候診，等待醫生補充資料`,
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

// 批價清單有沒有變動只看陣列內容是否相同，不逐項比對細節，通知文案只需要「有沒有動過」。
function billingItemsChanged(before, after) {
  return JSON.stringify(before?.billingItems ?? []) !== JSON.stringify(after?.billingItems ?? []);
}

export function describeVisitChanges(before, after) {
  const labels = [
    ['看診備註', ['visitNote']],
    ['特殊照護', ['specialCareNote']],
    ['量測資料', ['weightKg', 'temperatureC']],
    ['回診資料', ['followUpDate', 'followUpTime', 'followUpReason']],
  ].filter(([, fields]) => changedAppointmentFields(before, after, fields).length).map(([label]) => label);
  if (billingItemsChanged(before, after)) labels.push('批價項目');
  return labels;
}
