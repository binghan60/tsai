import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attendanceBadges, attendanceTotal, shortDateLabel } from './attendance.js';

test('attendanceTotal：遲到加未到，沒有資料算 0', () => {
  assert.equal(attendanceTotal({ lateCount: 3, noShowCount: 1 }), 4);
  assert.equal(attendanceTotal(null), 0);
});

test('shortDateLabel：今年只寫月日，跨年帶年份，格式不對回空字串', () => {
  assert.equal(shortDateLabel('2026-09-28', '2026-10-07'), '9/28');
  assert.equal(shortDateLabel('2025-12-03', '2026-10-07'), '2025/12/3');
  assert.equal(shortDateLabel(null, '2026-10-07'), '');
});

test('attendanceBadges：次數是 0 的不出現', () => {
  assert.deepEqual(attendanceBadges({ lateCount: 0, noShowCount: 0 }, '2026-10-07'), []);
  assert.deepEqual(attendanceBadges({ lateCount: 3, lastLateDate: '2026-09-28', noShowCount: 0 }, '2026-10-07'), [
    { kind: 'late', label: '遲到', count: 3, last: '9/28' },
  ]);
  assert.deepEqual(
    attendanceBadges({ lateCount: 5, lastLateDate: '2026-10-02', noShowCount: 1, lastNoShowDate: '2026-08-15' }, '2026-10-07').map((badge) => badge.kind),
    ['late', 'no_show'],
  );
});
