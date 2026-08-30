import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recordVisitDateRange } from './records.js';

describe('recordVisitDateRange', () => {
  it('uses a Taipei half-open date range', () => {
    const range = recordVisitDateRange({ from: '2026-08-20', to: '2026-08-20' });

    assert.equal(range.$gte.toISOString(), '2026-08-19T16:00:00.000Z');
    assert.equal(range.$lt.toISOString(), '2026-08-20T16:00:00.000Z');
    assert.equal('$lte' in range, false);
  });

  it('ignores invalid date inputs', () => {
    assert.deepEqual(recordVisitDateRange({ from: '2026/08/20', to: 'invalid' }), {});
  });
});
