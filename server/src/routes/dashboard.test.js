import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildWeekBoundaries, fillWeeklyTrend } from './dashboard.js';

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
