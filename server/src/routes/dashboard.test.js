import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildWeekBoundaries, fillWeeklyTrend, prioritizeActionRecords } from './dashboard.js';

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
