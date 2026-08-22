import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { groupDeliveryAttempts } from './deliveryAttempts.js';

function log(overrides) {
  return {
    _id: overrides._id,
    recordId: 'record-1',
    recipient: 'owner@example.com',
    createdAt: overrides.createdAt,
    event: overrides.event,
    attemptId: overrides.attemptId ?? '',
  };
}

describe('delivery attempt grouping', () => {
  it('merges queued and outcome events with the same attempt id', () => {
    const attempts = groupDeliveryAttempts([
      log({ _id: 'sent', event: 'sent', attemptId: 'attempt-1', createdAt: '2026-08-22T10:01:00Z' }),
      log({ _id: 'queued', event: 'queued', attemptId: 'attempt-1', createdAt: '2026-08-22T10:00:00Z' }),
    ]);

    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].event, 'sent');
    assert.equal(attempts[0].startedAt, '2026-08-22T10:00:00Z');
    assert.equal(attempts[0].completedAt, '2026-08-22T10:01:00Z');
  });

  it('pairs legacy events only when report, recipient and time window match', () => {
    const attempts = groupDeliveryAttempts([
      log({ _id: 'failed', event: 'failed', createdAt: '2026-08-22T10:01:00Z' }),
      log({ _id: 'queued', event: 'queued', createdAt: '2026-08-22T10:00:00Z' }),
      log({ _id: 'old', event: 'queued', createdAt: '2026-08-22T08:00:00Z' }),
    ]);

    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].event, 'failed');
    assert.equal(attempts[0].startedAt, '2026-08-22T10:00:00Z');
    assert.equal(attempts[1].event, 'queued');
  });
});
