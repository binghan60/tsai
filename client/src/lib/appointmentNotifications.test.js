import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appointmentNotification, changedAppointmentFields, describeVisitChanges } from './appointmentNotifications.js';

const appointment = { _id: 'appointment-1', petName: '豆豆', date: '2026-09-06', time: '14:00' };

// 執行頁面的實際操作函式，攔截 HTTP 與通知，避免測試發送任何聊天室訊息。
const page = readFileSync(new URL('../pages/AppointmentsPage.vue', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function handler(name, dependencies) {
  const start = page.indexOf(`async function ${name}(`);
  const end = page.indexOf('\n}\n', start) + 2;
  assert.ok(start >= 0 && end > start);
  return new Function(...Object.keys(dependencies), `${page.slice(start, end)}; return ${name};`)(...Object.values(dependencies));
}

test('回診掛號只傳 petId，通知仍使用後端回傳的姓名及日期時間', async () => {
  const messages = [];
  const submit = handler('submitNewAppointment', {
    newAppointmentSubmitting: { value: false }, newAppointmentError: { value: '' }, newAppointmentOpen: { value: true },
    http: { post: async (_url, payload) => { assert.equal(payload.petName, undefined); return { data: appointment }; } },
    toast: { success() {} }, appointmentNotification,
    notifyChat: (...args) => messages.push(appointmentNotification(...args)), fetchAppointments: async () => {},
  });
  await submit({ petId: 'pet-1', date: appointment.date, time: appointment.time });
  assert.equal(messages.length, 1);
  assert.match(messages[0], /已為「豆豆」新增掛號/);
  assert.match(messages[0], /2026.*9.*6.*14:00/);
  assert.doesNotMatch(messages[0], /這隻寵物/);
});

test('編輯掛號以儲存後姓名通知，無變更時不送請求或通知', async () => {
  const target = { value: { ...appointment } };
  const messages = [];
  let requests = 0;
  const submit = handler('submitEditAppointment', {
    editTarget: target, editSubmitting: { value: false }, editError: { value: '' },
    changedAppointmentFields, markSelfUpdate() {}, toast: { success() {}, info() {} },
    http: { put: async () => { requests++; return { data: { ...appointment, petName: '豆花' } }; } },
    notifyChat: (...args) => messages.push(appointmentNotification(...args)), fetchAppointments: async () => {},
  });
  await submit({ ...appointment });
  assert.equal(requests, 0);
  assert.equal(messages.length, 0);
  target.value = { ...appointment };
  await submit({ ...appointment, petName: '豆花' });
  assert.equal(requests, 1);
  assert.match(messages[0], /「豆花」的掛號資料已更新/);
});

test('看診資料原樣儲存不送請求或通知，數字格式與空白不算變更', async () => {
  const original = { weightKg: 5, temperatureC: null, visitNote: '備註', followUpDate: '', followUpTime: '', followUpReason: '' };
  let notices = 0;
  const submit = handler('saveCompletedVisit', {
    completedVisitTarget: { value: appointment }, completedVisitOriginal: original,
    completedVisitForm: { ...original, weightKg: '5.00', temperatureC: '', visitNote: ' 備註 ' },
    followUpTimeMissing: () => false, describeVisitChanges, toast: { info() { notices++; } },
  });
  // 其餘依賴刻意不提供；若沒有提前返回，就會測試失敗。
  await submit();
  assert.equal(notices, 1);
  assert.deepEqual(describeVisitChanges(original, { ...original, weightKg: '', visitNote: '', followUpReason: '追蹤' }), ['看診備註', '量測資料', '回診資料']);
  assert.deepEqual(describeVisitChanges({ weightKg: null }, { weightKg: 0 }), ['量測資料']);
});

test('恢復掛號與取消報到均描述待報到，未指定時間不冒充實際預約時間', () => {
  for (const action of ['restore', 'undo_check_in']) {
    const message = appointmentNotification({ ...appointment, time: '' }, action);
    assert.match(message, /等待報到|待報到/);
    assert.doesNotMatch(message, /恢復候診/);
    assert.match(message, /未指定時間/);
  }
  assert.match(appointmentNotification({ ...appointment, cancelReason: '改期' }, 'cancel'), /掛號已取消（原因：改期）/);
});
