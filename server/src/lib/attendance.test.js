import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attendanceCounts, attendanceFilter, attendanceKind, attendanceRow } from './attendance.js';

test('attendanceFilter 只收未到，以及真的到院而且遲到的掛號', () => {
  const filter = attendanceFilter({ petId: 'p1' });
  assert.equal(filter.petId, 'p1');
  assert.deepEqual(filter.$or[0], { status: 'no_show' });
  // 取消報到後 latenessMinutes 還留著，所以遲到那一支要連狀態一起限制。
  assert.deepEqual(filter.$or[1].status.$in, ['arrived', 'pending_checkout', 'completed']);
  assert.deepEqual(filter.$or[1].latenessMinutes, { $gt: 0 });
});

test('attendanceKind：未到優先，其餘是遲到', () => {
  assert.equal(attendanceKind({ status: 'no_show', latenessMinutes: 12 }), 'no_show');
  assert.equal(attendanceKind({ status: 'completed', latenessMinutes: 12 }), 'late');
});

test('attendanceRow：未到沒有到院時間與遲到分鐘', () => {
  const checkedInAt = new Date('2026-09-28T06:42:00Z');
  const late = attendanceRow({ _id: 'a1', status: 'completed', date: '2026-09-28', time: '14:15', checkedInAt, latenessMinutes: 27, petId: 'p1', petName: '豆豆', reason: '回診' });
  assert.deepEqual(late, { _id: 'a1', kind: 'late', date: '2026-09-28', time: '14:15', checkedInAt, latenessMinutes: 27, petId: 'p1', petName: '豆豆', reason: '回診' });

  const noShow = attendanceRow({ _id: 'a2', status: 'no_show', date: '2026-08-15', time: '15:00', checkedInAt: null, latenessMinutes: 9 });
  assert.equal(noShow.kind, 'no_show');
  assert.equal(noShow.checkedInAt, null);
  assert.equal(noShow.latenessMinutes, 0);
  assert.equal(noShow.petId, null);
  assert.equal(noShow.petName, '');
  assert.equal(noShow.reason, '');
});

test('attendanceCounts：缺的那一組補 0，不補日期', () => {
  assert.deepEqual(attendanceCounts([{ _id: 'late', count: 3, lastDate: '2026-09-28' }]), {
    lateCount: 3,
    lastLateDate: '2026-09-28',
    noShowCount: 0,
    lastNoShowDate: null,
  });
  assert.deepEqual(attendanceCounts(), { lateCount: 0, lastLateDate: null, noShowCount: 0, lastNoShowDate: null });
});
