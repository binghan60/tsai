import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appointmentStatusCounts, buildWeekBoundaries, deliveryBreakdown, deliveryRate, fillWeeklyTrend, prioritizeActionRecords } from './dashboard.js';

describe('dashboard visit-date trend', () => {
  it('builds contiguous weekly buckets and fills missing weeks', () => {
    const start = new Date('2026-07-01T00:00:00.000Z');
    const boundaries = buildWeekBoundaries(start, 3);
    assert.deepEqual(boundaries.map((date) => date.toISOString()), [
      '2026-07-01T00:00:00.000Z',
      '2026-07-08T00:00:00.000Z',
      '2026-07-15T00:00:00.000Z',
      '2026-07-22T00:00:00.000Z',
    ]);

    assert.deepEqual(fillWeeklyTrend(boundaries, [{ _id: boundaries[1], count: 4 }]), [
      { weekEnd: boundaries[1], count: 0 },
      { weekEnd: boundaries[2], count: 4 },
      { weekEnd: boundaries[3], count: 0 },
    ]);
  });
});

describe('dashboard action queue', () => {
  it('orders attention before pending and drafts while removing duplicates', () => {
    const attention = [{ _id: 'failed-1' }, { _id: 'shared' }];
    const pending = [{ _id: 'shared' }, { _id: 'pending-1' }];
    const drafts = [{ _id: 'draft-1' }];

    assert.deepEqual(
      prioritizeActionRecords(attention, pending, drafts).map((record) => record._id),
      ['failed-1', 'shared', 'pending-1', 'draft-1']
    );
  });

  it('caps the queue after applying priority order', () => {
    assert.deepEqual(
      prioritizeActionRecords([{ _id: 'failed' }], [{ _id: 'pending' }], [{ _id: 'draft' }], 2)
        .map((record) => record._id),
      ['failed', 'pending']
    );
  });
});

describe('dashboard operating metrics', () => {
  it('fills missing appointment statuses with zero', () => {
    assert.deepEqual(appointmentStatusCounts([{ _id: 'arrived', count: 3 }, { _id: 'completed', count: 2 }]), {
      scheduled: 0,
      arrived: 3,
      completed: 2,
      cancelled: 0,
      no_show: 0,
    });
  });

  it('calculates delivery success only when there are delivery outcomes', () => {
    assert.equal(deliveryRate({ sent: 8, pending: 1, failed: 1 }), 80);
    assert.equal(deliveryRate(), null);
  });

  it('counts an uncertain record in both pending and failed without double-counting it in the success rate', () => {
    // 10 筆已結案：1 sent、1 uncertain、8 not_sent（歸類為 finalized）。
    const statusBreakdown = { finalized: 8, sending: 0, sent: 1, failed: 0, uncertain: 1 };
    const result = deliveryBreakdown(statusBreakdown);
    assert.equal(result.pending, 9, '寄送異常卡片文案與 /records?view=pending 都把 uncertain 算進去');
    assert.equal(result.failed, 1, '寄送異常卡片文案與 /records?view=failed 都把 uncertain 算進去');
    // 分母是 10（每筆報告只算一次），不是 sent(1)+pending(9)+failed(1)=11。
    assert.equal(result.successRate, 10);
  });
});
