import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildWeekBoundaries, deliveryBreakdown, fillWeeklyTrend, todayClinic } from './dashboard.js';

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
      { weekStart: boundaries[0], weekEnd: boundaries[1], count: 0 },
      { weekStart: boundaries[1], weekEnd: boundaries[2], count: 4 },
      { weekStart: boundaries[2], weekEnd: boundaries[3], count: 0 },
    ]);
  });
});

describe('dashboard today clinic', () => {
  it('splits today into the same stages as the reception flow bar', () => {
    const result = todayClinic([
      { time: '10:00', status: 'scheduled' },
      { time: '10:15', status: 'arrived', visitStartedAt: new Date() },
      { time: '10:30', status: 'arrived' },
      { time: '11:00', status: 'pending_checkout' },
      { time: '14:00', status: 'completed', followUpRecommendation: '兩週後回診' },
      { time: '14:15', status: 'completed', followUpRecommendation: '一個月後', followUpAppointmentId: 'next' },
      { time: '15:00', status: 'completed' },
      { time: '16:00', status: 'cancelled' },
      { time: '17:00', status: 'no_show' },
    ]);
    assert.deepEqual(result, {
      total: 7, morning: 4, afternoon: 3,
      onsite: 2, inVisit: 1, waiting: 1,
      handoff: 1,
      completed: 3, followUpPending: 1,
    });
  });

  it('is all zero without appointments', () => {
    assert.equal(todayClinic().total, 0);
  });
});

describe('dashboard report counts', () => {
  it('counts an uncertain record in both pending and failed, matching the records list views', () => {
    // 10 筆已結案：1 sent、1 uncertain、8 not_sent（歸類為 finalized）。
    const result = deliveryBreakdown({ finalized: 8, sending: 0, sent: 1, failed: 0, uncertain: 1 });
    assert.equal(result.pending, 9, '/records?view=pending 把 uncertain 算進去');
    assert.equal(result.failed, 1, '/records?view=failed 把 uncertain 算進去');
  });
});
