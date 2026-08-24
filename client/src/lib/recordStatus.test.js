import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAvailabilityStatusMeta, getDeliveryStatus, getRecordWorkflowStatusMeta, isFinalizedRecord } from './recordStatus.js';

describe('record status helpers', () => {
  it('keeps lifecycle and delivery state independent', () => {
    assert.equal(isFinalizedRecord({ status: 'finalized', deliveryStatus: 'failed' }), true);
    assert.equal(isFinalizedRecord({ status: 'draft', deliveryStatus: 'not_sent' }), false);
    assert.equal(getDeliveryStatus({ status: 'finalized' }), 'not_sent');
  });

  it('uses one canonical presentation for workflow and availability statuses', () => {
    assert.equal(getRecordWorkflowStatusMeta({ status: 'draft' }).label, '草稿');
    assert.equal(getRecordWorkflowStatusMeta({ status: 'finalized', deliveryStatus: 'not_sent' }).label, '待寄送');
    // 綁語意 token 而不是色階名：這裡要釘住的是「寄送失敗走 danger 這個語意」，
    // 至於 danger 今天是哪個紅，本來就該能換。
    assert.match(getRecordWorkflowStatusMeta({ status: 'finalized', deliveryStatus: 'failed' }).class, /danger/);
    assert.equal(getAvailabilityStatusMeta(true).label, '使用中');
    assert.equal(getAvailabilityStatusMeta(false).label, '已停用');
  });
});
