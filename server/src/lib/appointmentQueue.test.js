import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { positionUpdates, queueOrder } from './appointmentQueue.js';

const at = (iso) => new Date(iso);

describe('appointment queue ordering', () => {
  it('orders by position and puts freshly arrived rows last', () => {
    const ordered = queueOrder([
      { _id: 'c', checkinNumber: null, checkedInAt: at('2026-08-27T01:00:00Z') },
      { _id: 'b', checkinNumber: 2 },
      { _id: 'a', checkinNumber: 1 },
    ]);
    assert.deepEqual(ordered.map((item) => item._id), ['a', 'b', 'c']);
  });

  it('breaks ties on check-in time so every caller derives the same order', () => {
    const ordered = queueOrder([
      { _id: 'late', checkinNumber: null, checkedInAt: at('2026-08-27T02:00:00Z') },
      { _id: 'early', checkinNumber: null, checkedInAt: at('2026-08-27T01:00:00Z') },
    ]);
    assert.deepEqual(ordered.map((item) => item._id), ['early', 'late']);
  });
});

describe('appointment queue numbering', () => {
  it('numbers the queue 1..N and reports only the rows that actually move', () => {
    assert.deepEqual(
      positionUpdates([{ _id: 'a', checkinNumber: 1 }, { _id: 'c', checkinNumber: 3 }, { _id: 'b', checkinNumber: 2 }]),
      [{ _id: 'c', checkinNumber: 2 }, { _id: 'b', checkinNumber: 3 }]
    );
  });

  // 有人看完診離開佇列之後，後面的人遞補上來，號碼重新連續。
  it('closes the gap left by a row that left the queue', () => {
    assert.deepEqual(
      positionUpdates([{ _id: 'b', checkinNumber: 2 }, { _id: 'c', checkinNumber: 3 }]),
      [{ _id: 'b', checkinNumber: 1 }, { _id: 'c', checkinNumber: 2 }]
    );
  });

  it('assigns a number to a row that has none yet', () => {
    assert.deepEqual(
      positionUpdates([{ _id: 'a', checkinNumber: 1 }, { _id: 'new', checkinNumber: null }]),
      [{ _id: 'new', checkinNumber: 2 }]
    );
  });
});
