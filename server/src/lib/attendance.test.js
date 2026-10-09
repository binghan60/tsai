import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attendanceCounts, attendanceFilter, attendanceKind, attendanceListFilter, attendanceRow } from './attendance.js';

test('attendanceFilter 只收未到，以及真的到院而且遲到的掛號', () => {
  const filter = attendanceFilter({ petId: 'p1' });
  assert.equal(filter.petId, 'p1');
  assert.equal(filter.$or.length, 2);
  assert.deepEqual(filter.$or[0], { status: 'no_show' });
  // 取消報到後 latenessMinutes 還留著，所以遲到那一支要連狀態一起限制。
  assert.deepEqual(filter.$or[1].status.$in, ['arrived', 'pending_checkout', 'completed']);
  assert.deepEqual(filter.$or[1].latenessMinutes, { $gt: 0 });
});

test('attendanceListFilter 另外收決定過保證金的掛號，算次數的那一支不收', () => {
  const filter = attendanceListFilter({ petId: 'p1' });
  assert.equal(filter.$or.length, 4);
  assert.deepEqual(filter.$or[2], { depositStatus: { $in: ['collected', 'waived', 'refunded', 'carried'] } });
  // 已取消的掛號也列在清單上，但不算次數。
  assert.deepEqual(filter.$or[3], { status: 'cancelled' });
  assert.equal(attendanceFilter({ petId: 'p1' }).$or.length, 2);
});

test('已取消的掛號：帶取消時間與原因，沒有到院時間', () => {
  const cancelledAt = new Date('2026-10-09T06:32:00Z');
  const row = attendanceRow({ _id: 'a9', status: 'cancelled', date: '2026-10-12', time: '14:30', checkedInAt: null, latenessMinutes: 8, cancelledAt, cancelReason: '飼主臨時有事' });
  assert.equal(row.kind, 'cancelled');
  assert.equal(row.cancelled, true);
  assert.equal(row.cancelledAt, cancelledAt);
  assert.equal(row.cancelReason, '飼主臨時有事');
  assert.equal(row.latenessMinutes, 0);
});

test('attendanceKind：未到優先，到院且遲到是遲到，其餘只是保證金紀錄', () => {
  assert.equal(attendanceKind({ status: 'no_show', latenessMinutes: 12 }), 'no_show');
  assert.equal(attendanceKind({ status: 'completed', latenessMinutes: 12 }), 'late');
  assert.equal(attendanceKind({ status: 'scheduled', latenessMinutes: 0, depositStatus: 'collected' }), 'deposit');
  // 遲到報到後又取消報到：分鐘數還在，但人不算到院，不是遲到。
  assert.equal(attendanceKind({ status: 'scheduled', latenessMinutes: 8, depositStatus: 'waived' }), 'deposit');
});

test('attendanceRow：未到沒有到院時間與遲到分鐘', () => {
  const checkedInAt = new Date('2026-09-28T06:42:00Z');
  const late = attendanceRow({ _id: 'a1', status: 'completed', date: '2026-09-28', time: '14:15', checkedInAt, latenessMinutes: 27, petId: 'p1', petName: '豆豆', reason: '回診' });
  assert.deepEqual(late, {
    _id: 'a1', kind: 'late', date: '2026-09-28', time: '14:15', checkedInAt, latenessMinutes: 27, petId: 'p1', petName: '豆豆', reason: '回診', cancelled: false, cancelledAt: null, cancelReason: '',
    depositStatus: '', depositWaiveReason: '', depositDecidedAt: null,
  });

  const noShow = attendanceRow({ _id: 'a2', status: 'no_show', date: '2026-08-15', time: '15:00', checkedInAt: null, latenessMinutes: 9 });
  assert.equal(noShow.kind, 'no_show');
  assert.equal(noShow.checkedInAt, null);
  assert.equal(noShow.latenessMinutes, 0);
  assert.equal(noShow.petId, null);
  assert.equal(noShow.petName, '');
  assert.equal(noShow.reason, '');
});

test('attendanceRow：保證金的決定跟著那筆掛號，不收才帶原因', () => {
  const decidedAt = new Date('2026-10-01T03:00:00Z');
  const collected = attendanceRow({ _id: 'a3', status: 'scheduled', date: '2026-10-12', time: '14:30', depositStatus: 'collected', depositWaiveReason: '殘留', depositDecidedAt: decidedAt });
  assert.equal(collected.kind, 'deposit');
  assert.equal(collected.depositStatus, 'collected');
  assert.equal(collected.depositWaiveReason, '');
  assert.equal(collected.depositDecidedAt, decidedAt);

  const waived = attendanceRow({ _id: 'a4', status: 'completed', date: '2026-10-12', time: '14:30', latenessMinutes: 6, depositStatus: 'waived', depositWaiveReason: '醫師同意', depositDecidedAt: decidedAt });
  assert.equal(waived.kind, 'late');
  assert.equal(waived.depositStatus, 'waived');
  assert.equal(waived.depositWaiveReason, '醫師同意');
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
