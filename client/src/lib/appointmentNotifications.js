import { formatDate } from './datetime.js';

export function appointmentSubject(appointment) {
  const name = String(appointment.petName ?? '').trim();
  return name ? `「${name}」` : '未填姓名的病患';
}

// 全站聊天室的系統訊息文案。集中在這裡是為了讓「發生了什麼事」只有一種說法——
// 開著聊天視窗的另一邊不用切回診務頁，也知道現場的進度。
export function appointmentNotification(appointment, action, { changedParts = [] } = {}) {
  const subject = appointmentSubject(appointment);
  const messages = {
    create: `已為${subject}新增掛號`,
    check_in: `${subject}已報到`,
    card_number: `${subject}的號碼牌已改為 ${appointment.checkinNumber} 號`,
    handoff: `${subject}已完成看診，交給櫃台處理`,
    reclaim: `${subject}被醫師取回修改，暫時退回看診中`,
    desk_complete: `${subject}的櫃台作業已完成，這次看診結束`,
    follow_up: `${subject}已預約回診（${formatDate(appointment.followUpDate)} ${appointment.followUpTime || '未指定時間'}）`,
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

// 只講真正變動的部分。空值、前後空白與等值的數字格式都不算變更，
// 否則使用者原樣按一次儲存，聊天室就會冒出一則「已更新」。
export function describeVisitChanges(before, after) {
  return [
    ['本次簡易紀錄', ['visitNote']],
    ['內部備註', ['internalNote']],
    ['櫃台交辦', ['handoffNote']],
    ['飼主提醒', ['specialCareNote']],
    ['量測資料', ['weightKg', 'temperatureC']],
    ['回診資料', ['followUpRecommendation', 'followUpReason', 'followUpDate', 'followUpTime']],
  ].filter(([, fields]) => changedAppointmentFields(before, after, fields).length).map(([label]) => label);
}
