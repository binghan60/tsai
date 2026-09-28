import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { APPOINTMENT_TIME_ERROR, appointmentSlotErrors } from './appointmentTime.js';

describe('appointmentSlotErrors', () => {
  it('日期與時段都必填', () => {
    assert.deepEqual(appointmentSlotErrors({ date: '', time: '' }), { date: '請選擇掛號日期', time: '請選擇預約時段' });
  });

  it('時段要落在診別內、15 分鐘一格', () => {
    assert.equal(appointmentSlotErrors({ date: '2026-10-01', time: '12:00' }).time, APPOINTMENT_TIME_ERROR);
    assert.equal(appointmentSlotErrors({ date: '2026-10-01', time: '14:10' }).time, APPOINTMENT_TIME_ERROR);
    assert.deepEqual(appointmentSlotErrors({ date: '2026-10-01', time: '19:30' }), {});
  });

  it('今天已經過去的時間不能選，別天不管', () => {
    assert.match(appointmentSlotErrors({ date: '2026-10-01', time: '14:00', today: '2026-10-01', nowTime: '15:02' }).time, /已經過了/);
    assert.deepEqual(appointmentSlotErrors({ date: '2026-10-02', time: '14:00', today: '2026-10-01', nowTime: '15:02' }), {});
  });

  it('預估診療時間要塞得進同一個診別', () => {
    assert.match(appointmentSlotErrors({ date: '2026-10-01', time: '11:30', durationMinutes: 30 }).time, /超出/);
    assert.deepEqual(appointmentSlotErrors({ date: '2026-10-01', time: '11:15', durationMinutes: 30 }), {});
  });
});
