import test from 'node:test';
import assert from 'node:assert/strict';
import { appointmentNotification, appointmentSubject, changedAppointmentFields, describeVisitChanges } from './appointmentNotifications.js';

const appointment = { _id: 'appointment-1', petName: '豆豆', date: '2026-09-06', time: '14:00' };

test('每則通知都帶掛號日期與時間，沒填時間時明說未指定', () => {
  assert.match(appointmentNotification(appointment, 'check_in'), /「豆豆」已報到/);
  assert.match(appointmentNotification(appointment, 'check_in'), /2026.*9.*6.*14:00/);
  assert.match(appointmentNotification({ ...appointment, time: '' }, 'check_in'), /未指定時間/);
  assert.match(appointmentNotification({ ...appointment, petName: '  ' }, 'create'), /未填姓名的病患/);
  assert.equal(appointmentSubject({ petName: '豆豆' }), '「豆豆」');
});

test('四步流程的三個轉場各有明確說法，不再出現任何金額', () => {
  const handoff = appointmentNotification(appointment, 'handoff');
  assert.match(handoff, /已完成看診，交給櫃台處理/);
  assert.doesNotMatch(handoff, /NT\$|金額|結帳/);

  assert.match(appointmentNotification(appointment, 'reclaim'), /被醫師取回修改，暫時退回看診中/);

  const complete = appointmentNotification(appointment, 'desk_complete');
  assert.match(complete, /櫃台作業已完成，這次看診結束/);
  assert.doesNotMatch(complete, /NT\$|結算/);
});

test('約好回診的通知帶出實際約定的日期時間', () => {
  const message = appointmentNotification({ ...appointment, followUpDate: '2026-09-22', followUpTime: '10:30' }, 'follow_up');
  assert.match(message, /已預約回診/);
  assert.match(message, /2026.*9.*22.*10:30/);
});

test('恢復掛號與取消報到均描述待報到，取消掛號帶出原因', () => {
  for (const action of ['restore', 'undo_check_in']) {
    assert.match(appointmentNotification(appointment, action), /等待報到|待報到/);
  }
  assert.match(appointmentNotification({ ...appointment, cancelReason: '改期' }, 'cancel'), /掛號已取消（原因：改期）/);
  assert.throws(() => appointmentNotification(appointment, 'send_to_checkout'), /Unknown appointment notification/);
});

test('describeVisitChanges 只講真正變動的部分', () => {
  const changedParts = describeVisitChanges({ visitNote: '原紀錄' }, { visitNote: '新紀錄' });
  assert.deepEqual(changedParts, ['本次簡易紀錄']);
  assert.match(appointmentNotification(appointment, 'visit_data', { changedParts }), /「豆豆」的本次簡易紀錄已更新/);
  const before = { visitNote: '備註', handoffNote: '', specialCareNote: '', weightKg: 5, temperatureC: null, followUpRecommendation: '' };
  // 空白與等值的數字格式不算變更，原樣按儲存不會冒出「已更新」。
  assert.deepEqual(describeVisitChanges(before, { ...before, visitNote: ' 備註 ', weightKg: '5.00' }), []);
  assert.deepEqual(describeVisitChanges(before, { ...before, handoffNote: '診察費＋X光' }), ['櫃台交辦']);
  assert.deepEqual(describeVisitChanges(before, { ...before, specialCareNote: '傷口勿舔舐' }), ['飼主提醒']);
  assert.deepEqual(describeVisitChanges(before, { ...before, weightKg: '', followUpRecommendation: '兩週後' }), ['量測資料', '回診資料']);
  assert.deepEqual(describeVisitChanges({ weightKg: null }, { weightKg: 0 }), ['量測資料']);
});

test('changedAppointmentFields 用於掛號資料，數字欄位以數值比較', () => {
  assert.deepEqual(changedAppointmentFields({ time: '14:00' }, { time: '14:30' }, ['time']), ['time']);
  assert.deepEqual(changedAppointmentFields({ weightKg: '5' }, { weightKg: 5 }, ['weightKg']), []);
});
