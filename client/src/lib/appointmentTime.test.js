import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { APPOINTMENT_TIME_ERROR, DURATION_OVERFLOW_ERROR, appointmentSlotErrors, durationOverflowError } from './appointmentTime.js';

describe('durationOverflowError', () => {
  it('診療時間塞得進開始時間所在的診別就沒事', () => {
    assert.equal(durationOverflowError('11:15', 30), '');
    assert.equal(durationOverflowError('19:30', 15), '');
    assert.equal(durationOverflowError('14:00', 240), '');
  });

  it('跨出診別結束（含午休）就提示', () => {
    assert.equal(durationOverflowError('11:45', 30), DURATION_OVERFLOW_ERROR);
    assert.equal(durationOverflowError('19:00', 60), DURATION_OVERFLOW_ERROR);
  });

  it('沒選或不在診別內的時段不歸它管', () => {
    assert.equal(durationOverflowError('', 60), '');
    assert.equal(durationOverflowError('12:00', 60), '');
  });
});

describe('appointmentSlotErrors', () => {
  it('日期與時段都必填', () => {
    assert.deepEqual(appointmentSlotErrors({ date: '', time: '' }), { date: '請選擇掛號日期', time: '請選擇預約時段' });
  });

  it('時段要落在診別內、15 分鐘一格', () => {
    assert.equal(appointmentSlotErrors({ date: '2026-10-01', time: '12:00' }).time, APPOINTMENT_TIME_ERROR);
    assert.equal(appointmentSlotErrors({ date: '2026-10-01', time: '14:10' }).time, APPOINTMENT_TIME_ERROR);
    assert.deepEqual(appointmentSlotErrors({ date: '2026-10-01', time: '19:30' }), {});
  });

  it('今天已經過去的時間照樣能選（現場補登）', () => {
    assert.deepEqual(appointmentSlotErrors({ date: '2026-10-01', time: '10:00', today: '2026-10-01', nowTime: '15:02' }), {});
  });

  it('預估診療時間要塞得進同一個診別', () => {
    assert.match(appointmentSlotErrors({ date: '2026-10-01', time: '11:45', durationMinutes: 30 }).time, /超出/);
    assert.deepEqual(appointmentSlotErrors({ date: '2026-10-01', time: '11:15', durationMinutes: 30 }), {});
  });
});
