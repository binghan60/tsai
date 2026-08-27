import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nextAvailableCheckinNumber, queueOrder } from './appointmentQueue.js';

const at = (iso) => new Date(iso);

describe('appointment queue ordering', () => {
  it('依報到時間排序，不受手上的實體牌號影響', () => {
    const ordered = queueOrder([
      { _id: 'late', checkinNumber: 1, checkedInAt: at('2026-08-27T02:00:00Z') },
      { _id: 'early', checkinNumber: 8, checkedInAt: at('2026-08-27T01:00:00Z') },
    ]);
    assert.deepEqual(ordered.map((item) => item._id), ['early', 'late']);
  });

  it('報到時間相同時以 id 固定順序', () => {
    const ordered = queueOrder([
      { _id: 'b', checkinNumber: 2, checkedInAt: at('2026-08-27T01:00:00Z') },
      { _id: 'a', checkinNumber: 1, checkedInAt: at('2026-08-27T01:00:00Z') },
    ]);
    assert.deepEqual(ordered.map((item) => item._id), ['a', 'b']);
  });
});

describe('physical check-in card numbering', () => {
  it('自動配發今天從未使用過的最小牌號', () => {
    assert.equal(nextAvailableCheckinNumber([
      { checkinNumber: null, checkinNumberHistory: [1] },
      { checkinNumber: 3 },
      { checkinNumber: 4 },
    ]), 2);
  });

  it('已歸還或改掉的舊牌號仍算今日已使用', () => {
    assert.equal(nextAvailableCheckinNumber([
      { checkinNumber: null, checkinNumberHistory: [1, 2] },
      { checkinNumber: 3, checkinNumberHistory: [3] },
    ]), 4);
  });

  it('忽略空值與不合法牌號', () => {
    assert.equal(nextAvailableCheckinNumber([
      { checkinNumber: null },
      { checkinNumber: -1 },
      { checkinNumber: 2 },
    ]), 1);
  });

  it('沒有人候診時從 1 開始', () => {
    assert.equal(nextAvailableCheckinNumber([]), 1);
  });
});
