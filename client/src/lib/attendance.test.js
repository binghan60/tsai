import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attendanceBadges, attendanceDateLabel, attendanceRows, attendanceTotal } from './attendance.js';

test('attendanceRows：沒有紀錄的對象不列，最近一次取遲到與未到裡較晚的', () => {
  const rows = attendanceRows([
    { label: '豆豆', counts: { lateCount: 3, lastLateDate: '2026-09-28', noShowCount: 0, lastNoShowDate: null } },
    { label: '麻糬', counts: { lateCount: 0, noShowCount: 0 } },
    { label: '飼主王小明名下', counts: { lateCount: 5, lastLateDate: '2026-08-02', noShowCount: 1, lastNoShowDate: '2026-10-02' } },
    { label: '還沒讀到', counts: null },
  ]);
  assert.deepEqual(rows, [
    { label: '豆豆', late: 3, noShow: 0, last: '2026/9/28' },
    { label: '飼主王小明名下', late: 5, noShow: 1, last: '2026/10/2' },
  ]);
});

test('attendanceTotal：遲到加未到，沒有資料算 0', () => {
  assert.equal(attendanceTotal({ lateCount: 3, noShowCount: 1 }), 4);
  assert.equal(attendanceTotal(null), 0);
});

test('attendanceDateLabel：一律帶年份，格式不對回空字串', () => {
  assert.equal(attendanceDateLabel('2026-09-28'), '2026/9/28');
  assert.equal(attendanceDateLabel('2025-12-03'), '2025/12/3');
  assert.equal(attendanceDateLabel(null), '');
});

test('attendanceBadges：次數是 0 的不出現', () => {
  assert.deepEqual(attendanceBadges({ lateCount: 0, noShowCount: 0 }), []);
  assert.deepEqual(attendanceBadges({ lateCount: 3, lastLateDate: '2026-09-28', noShowCount: 0 }), [
    { kind: 'late', label: '遲到', count: 3, last: '2026/9/28' },
  ]);
  assert.deepEqual(
    attendanceBadges({ lateCount: 5, lastLateDate: '2026-10-02', noShowCount: 1, lastNoShowDate: '2026-08-15' }).map((badge) => badge.kind),
    ['late', 'no_show'],
  );
});
