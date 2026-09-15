import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSlotGrid, isOverdue, LATE_GRACE_MINUTES, minutesPastSchedule } from './receptionBoard.js';

const scheduledAt = '2026-09-15T06:00:00.000Z'; // 14:00 台北

describe('minutesPastSchedule / isOverdue', () => {
  it('只有待報到的掛號才會算超過預約時間', () => {
    const now = new Date('2026-09-15T06:20:00.000Z');
    assert.equal(minutesPastSchedule({ status: 'scheduled', scheduledAt }, now), 20);
    assert.equal(minutesPastSchedule({ status: 'arrived', scheduledAt }, now), 0);
    assert.equal(minutesPastSchedule({ status: 'scheduled', scheduledAt: 'bad' }, now), 0);
  });

  it('還沒到預約時間不會變成負數', () => {
    assert.equal(minutesPastSchedule({ status: 'scheduled', scheduledAt }, new Date('2026-09-15T05:50:00.000Z')), 0);
  });

  // 寬限是「超過」才算：剛好晚 10 分鐘仍當準時，第 11 分鐘才記遲到。
  it('寬限分鐘數是嚴格大於', () => {
    const at = (minutes) => new Date(new Date(scheduledAt).getTime() + minutes * 60000);
    assert.equal(LATE_GRACE_MINUTES, 10);
    assert.equal(isOverdue({ status: 'scheduled', scheduledAt }, at(10)), false);
    assert.equal(isOverdue({ status: 'scheduled', scheduledAt }, at(11)), true);
  });
});

describe('buildSlotGrid', () => {
  const sessions = [
    { id: 'morning', label: '上午診', start: '10:00', end: '11:30' },
    { id: 'afternoon', label: '下午診', start: '14:00', end: '15:10' },
  ];

  it('每個整點一列、每列 12 格，超出診別範圍的格子不可選但頭尾都可選', () => {
    const [morning, afternoon] = buildSlotGrid([], { sessions });
    assert.deepEqual(morning.rows.map((row) => row.hour), ['10:00', '11:00']);
    assert.equal(morning.rows[1].cells.length, 12);
    const eleven = morning.rows[1].cells;
    assert.equal(eleven.find((cell) => cell.time === '11:30').inRange, true);
    assert.equal(eleven.find((cell) => cell.time === '11:35').inRange, false);
    assert.deepEqual(afternoon.rows.map((row) => row.hour), ['14:00', '15:00']);
    assert.equal(afternoon.rows[1].cells.find((cell) => cell.time === '15:10').inRange, true);
  });

  it('同一時段的掛號都算進去，已取消、未到與正在編輯的那筆不佔位', () => {
    const [, afternoon] = buildSlotGrid([
      { _id: 'a', time: '14:30', status: 'scheduled', petName: '布丁' },
      { _id: 'b', time: '14:30', status: 'arrived', petName: '小白' },
      { _id: 'c', time: '14:30', status: 'cancelled', petName: '小花' },
      { _id: 'd', time: '14:30', status: 'no_show', petName: '旺財' },
      { _id: 'e', time: '14:30', status: 'scheduled', petName: '自己' },
    ], { sessions, excludeId: 'e' });
    const cell = afternoon.rows[0].cells.find((item) => item.time === '14:30');
    assert.deepEqual(cell.entries.map((item) => item.petName), ['布丁', '小白']);
  });

  it('minTime 之前的格子標為已過', () => {
    const [, afternoon] = buildSlotGrid([], { sessions, minTime: '14:20' });
    const cells = afternoon.rows[0].cells;
    assert.equal(cells.find((cell) => cell.time === '14:15').past, true);
    assert.equal(cells.find((cell) => cell.time === '14:20').past, false);
  });
});
