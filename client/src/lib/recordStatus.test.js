import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDeliveryStatus, isFinalizedRecord } from './recordStatus.js';

describe('record status helpers', () => {
  it('keeps lifecycle and delivery state independent', () => {
    assert.equal(isFinalizedRecord({ status: 'finalized', deliveryStatus: 'failed' }), true);
    assert.equal(isFinalizedRecord({ status: 'draft', deliveryStatus: 'not_sent' }), false);
    assert.equal(getDeliveryStatus({ status: 'finalized' }), 'not_sent');
  });
});
