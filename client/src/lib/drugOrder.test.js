import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planDrugMove, sortByDrugOrder } from '../../../shared/drugOrder.js';

describe('drugOrder', () => {
  it('排過的照 sortOrder，沒排過的接在最後（建立時間）', () => {
    const rows = [
      { _id: 'c', createdAt: '2026-10-03T00:00:00Z' },
      { _id: 'a', sortOrder: 1 },
      { _id: 'b', sortOrder: 0 },
      { _id: 'd', createdAt: '2026-10-04T00:00:00Z' },
    ];
    assert.deepEqual(sortByDrugOrder(rows).map((r) => r._id), ['b', 'a', 'c', 'd']);
  });

  it('同一組內移到某一筆前面', () => {
    assert.deepEqual(planDrugMove(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b']);
  });

  it('換組：目標組沒有這筆時先接在最後再移', () => {
    assert.deepEqual(planDrugMove(['x', 'y'], 'a', 'y'), ['x', 'a', 'y']);
    assert.deepEqual(planDrugMove(['x', 'y'], 'a', null), ['x', 'y', 'a']);
  });

  it('beforeId 不在目標清單回 null', () => {
    assert.equal(planDrugMove(['x', 'y'], 'a', 'zzz'), null);
  });
});
