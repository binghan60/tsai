import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSlotGrid, duplicateBookings, isOverdue, LATE_GRACE_MINUTES, minutesPastSchedule, sessionAutoCollapsed, slotCellLabel, slotSessions, SURGERY_SESSION } from './receptionBoard.js';

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
    { id: 'afternoon', label: '下午診', start: '14:00', end: '15:15' },
  ];

  it('每個整點一列、每列 4 格（15 分鐘一格），超出診別範圍的格子不可選但頭尾都可選', () => {
    const [morning, afternoon] = buildSlotGrid([], { sessions });
    assert.deepEqual(morning.rows.map((row) => row.hour), ['10:00', '11:00']);
    assert.equal(morning.rows[1].cells.length, 4);
    const eleven = morning.rows[1].cells;
    assert.equal(eleven.find((cell) => cell.time === '11:30').inRange, true);
    assert.equal(eleven.find((cell) => cell.time === '11:45').inRange, false);
    assert.deepEqual(afternoon.rows.map((row) => row.hour), ['14:00', '15:00']);
    assert.equal(afternoon.rows[1].cells.find((cell) => cell.time === '15:15').inRange, true);
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
    assert.equal(cells.find((cell) => cell.time === '14:30').past, false);
  });

  // 手術時段只在勾了手術時出現，夾在上午診與下午診中間，格子帶 surgery 標記。
  it('surgery 會插入手術時段那一組', () => {
    assert.deepEqual(slotSessions({ sessions }).map((session) => session.id), ['morning', 'afternoon']);
    assert.deepEqual(slotSessions({ sessions, surgery: true }).map((session) => session.id), ['morning', 'surgery', 'afternoon']);
    const [, surgery] = buildSlotGrid([], { sessions, surgery: true });
    assert.equal(surgery.surgery, true);
    assert.equal(surgery.label, SURGERY_SESSION.label);
    assert.deepEqual(surgery.rows.map((row) => row.hour), ['11:00', '12:00', '13:00']);
    assert.equal(surgery.rows[0].cells.find((cell) => cell.time === '11:30').inRange, false);
    assert.equal(surgery.rows[0].cells.find((cell) => cell.time === '11:45').inRange, true);
    assert.equal(surgery.rows[2].cells.find((cell) => cell.time === '13:45').inRange, true);
  });
});

describe('slotCellLabel', () => {
  it('兩位以內全列，三位以上只列前兩位加人數', () => {
    assert.deepEqual(slotCellLabel([{ petName: '豆豆' }]), { names: ['豆豆'], more: 0 });
    assert.deepEqual(slotCellLabel([{ petName: '豆豆' }, { petName: '皮皮' }, { petName: 'Momo' }]), { names: ['豆豆', '皮皮'], more: 1 });
    assert.deepEqual(slotCellLabel([]), { names: [], more: 0 });
  });
});

describe('duplicateBookings', () => {
  const items = [
    { _id: 'a', petId: 'p1', status: 'scheduled', time: '10:30' },
    { _id: 'b', petId: 'p1', status: 'cancelled', time: '11:00' },
    { _id: 'c', petId: 'p2', status: 'arrived', time: '10:15' },
  ];
  it('同一隻寵物當天有效的掛號才算重複，正在編輯的那筆不算', () => {
    assert.deepEqual(duplicateBookings(items, 'p1').map((item) => item._id), ['a']);
    assert.deepEqual(duplicateBookings(items, 'p1', 'a'), []);
    assert.deepEqual(duplicateBookings(items, ''), []);
  });
});

describe('sessionAutoCollapsed', () => {
  const group = { session: { id: 'morning', label: '上午診', start: '10:00', end: '11:30' }, items: [{ _id: 'a' }, { _id: 'b' }] };
  const at = (hour, minute) => new Date(2026, 8, 15, hour, minute);

  it('時段還沒結束不收合；不是今天也不收合', () => {
    assert.equal(sessionAutoCollapsed(group, { now: at(11, 30) }), false);
    assert.equal(sessionAutoCollapsed(group, { now: at(15, 0), isToday: false }), false);
  });

  it('時段結束後，沒有待處理才收合', () => {
    assert.equal(sessionAutoCollapsed(group, { now: at(11, 31) }), true);
    assert.equal(sessionAutoCollapsed(group, { now: at(11, 31), isPending: (item) => item._id === 'b' }), false);
  });
});
