import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canTransitionAppointmentStatus, holdsCheckinNumber } from './appointmentStatus.js';

// 這張表只管排班動作（報到、取消、未到、恢復／取消報到）。
// 看診流水線（送交櫃台、取回、完成）由三個里程碑推導，不走這裡——見 appointmentWorkflow.test.js。
describe('canTransitionAppointmentStatus', () => {
  it('待報到可以報到、取消或標記未到', () => {
    assert.equal(canTransitionAppointmentStatus('scheduled', 'arrived'), true);
    assert.equal(canTransitionAppointmentStatus('scheduled', 'cancelled'), true);
    assert.equal(canTransitionAppointmentStatus('scheduled', 'no_show'), true);
  });

  it('已報到（還在候診）可以取消報到或取消掛號', () => {
    assert.equal(canTransitionAppointmentStatus('arrived', 'scheduled'), true);
    assert.equal(canTransitionAppointmentStatus('arrived', 'cancelled'), true);
    // 人已經到了，不能再標成未到。
    assert.equal(canTransitionAppointmentStatus('arrived', 'no_show'), false);
  });

  it('送交櫃台與完成不是排班動作：這張表不放行，也沒有出路', () => {
    assert.equal(canTransitionAppointmentStatus('arrived', 'pending_checkout'), false);
    assert.equal(canTransitionAppointmentStatus('arrived', 'completed'), false);
    assert.equal(canTransitionAppointmentStatus('scheduled', 'completed'), false);
    for (const to of ['scheduled', 'arrived', 'cancelled', 'no_show', 'completed']) {
      assert.equal(canTransitionAppointmentStatus('pending_checkout', to), false);
      assert.equal(canTransitionAppointmentStatus('completed', to), false);
    }
  });

  it('已取消與未到可以恢復成待報到', () => {
    assert.equal(canTransitionAppointmentStatus('cancelled', 'scheduled'), true);
    assert.equal(canTransitionAppointmentStatus('no_show', 'scheduled'), true);
  });

  it('未到可以改成取消，取消不能改成未到', () => {
    assert.equal(canTransitionAppointmentStatus('no_show', 'cancelled'), true);
    assert.equal(canTransitionAppointmentStatus('cancelled', 'no_show'), false);
  });

  it('未知狀態一律回 false', () => {
    assert.equal(canTransitionAppointmentStatus('unknown', 'scheduled'), false);
    assert.equal(canTransitionAppointmentStatus('scheduled', 'unknown'), false);
  });
});

describe('holdsCheckinNumber', () => {
  it('在院（候診、看診）與待櫃台處理都算持有現場號碼牌', () => {
    assert.equal(holdsCheckinNumber('arrived'), true);
    assert.equal(holdsCheckinNumber('pending_checkout'), true);
  });

  it('其餘狀態不持有號碼牌', () => {
    assert.equal(holdsCheckinNumber('scheduled'), false);
    assert.equal(holdsCheckinNumber('completed'), false);
    assert.equal(holdsCheckinNumber('cancelled'), false);
    assert.equal(holdsCheckinNumber('no_show'), false);
  });
});
