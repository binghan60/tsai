import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canTransitionAppointmentStatus } from './appointmentStatus.js';

describe('canTransitionAppointmentStatus', () => {
  it('允許預約的正常到診流程', () => {
    assert.equal(canTransitionAppointmentStatus('scheduled', 'arrived'), true);
    assert.equal(canTransitionAppointmentStatus('arrived', 'completed'), true);
  });

  it('允許取消/未到診', () => {
    assert.equal(canTransitionAppointmentStatus('scheduled', 'cancelled'), true);
    assert.equal(canTransitionAppointmentStatus('scheduled', 'no_show'), true);
  });

  it('允許誤按後的復原', () => {
    assert.equal(canTransitionAppointmentStatus('arrived', 'scheduled'), true);
    assert.equal(canTransitionAppointmentStatus('cancelled', 'scheduled'), true);
    assert.equal(canTransitionAppointmentStatus('no_show', 'scheduled'), true);
  });

  it('completed 是終態，不能再變動', () => {
    assert.equal(canTransitionAppointmentStatus('completed', 'scheduled'), false);
    assert.equal(canTransitionAppointmentStatus('completed', 'arrived'), false);
    assert.equal(canTransitionAppointmentStatus('completed', 'cancelled'), false);
  });

  it('不能跳過中間態直接完成', () => {
    assert.equal(canTransitionAppointmentStatus('scheduled', 'completed'), false);
  });

  it('取消/未到診之間不能互轉，只能先回已預約', () => {
    assert.equal(canTransitionAppointmentStatus('cancelled', 'no_show'), false);
    assert.equal(canTransitionAppointmentStatus('no_show', 'cancelled'), true);
  });

  it('未知狀態一律回 false', () => {
    assert.equal(canTransitionAppointmentStatus('unknown', 'scheduled'), false);
    assert.equal(canTransitionAppointmentStatus('scheduled', 'unknown'), false);
  });
});
