import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSIONS,
  assignSessionIndex,
  groupBySession,
  isIdentityConfirmed,
  nowIndexInSession,
  splitAppointmentsByQueueState,
} from './appointmentTimeline.js';

function apt(overrides) {
  return { _id: 'x', status: 'scheduled', petId: null, scheduledAt: '2026-08-26T10:00:00.000Z', ...overrides };
}

describe('splitAppointmentsByQueueState', () => {
  it('已取消與未到分組計算，尚未報到與候診中維持原樣，已完成的直接消失', () => {
    const scheduled = apt({ _id: 'a', status: 'scheduled' });
    const arrived = apt({ _id: 'b', status: 'arrived' });
    const cancelled = apt({ _id: 'c', status: 'cancelled' });
    const noShow = apt({ _id: 'd', status: 'no_show' });
    const completed = apt({ _id: 'e', status: 'completed' });
    const result = splitAppointmentsByQueueState([scheduled, arrived, cancelled, noShow, completed]);
    assert.deepEqual(result.active.map((item) => item._id), ['a', 'b']);
    assert.deepEqual(result.cancelled.map((item) => item._id), ['c']);
    assert.deepEqual(result.noShow.map((item) => item._id), ['d']);
  });

  it('空陣列或缺少 status 不會炸掉', () => {
    const emptyResult = { active: [], cancelled: [], noShow: [] };
    assert.deepEqual(splitAppointmentsByQueueState([]), emptyResult);
    assert.deepEqual(splitAppointmentsByQueueState(undefined), emptyResult);
  });
});

describe('isIdentityConfirmed', () => {
  it('回診（有 petId）算已確認身分，初診（petId 是 null）不算', () => {
    assert.equal(isIdentityConfirmed(apt({ petId: 'pet-1' })), true);
    assert.equal(isIdentityConfirmed(apt({ petId: null })), false);
  });
});

describe('assignSessionIndex', () => {
  it('落在時段範圍內就歸屬那個時段', () => {
    assert.equal(assignSessionIndex(10 * 60), 0); // 10:00 → 上午診
    assert.equal(assignSessionIndex(19 * 60), 1); // 19:00 → 下午診
  });

  it('落在手術時間這種時段之間的空隙，併入下一個時段，不會憑空消失', () => {
    assert.equal(assignSessionIndex(12 * 60 + 30), 1); // 12:30 落在手術時間，併入下午診
  });

  it('超出最後一個時段（例如晚上很晚才走的流程）就留在最後一個時段', () => {
    assert.equal(assignSessionIndex(21 * 60), 1);
  });
});

describe('groupBySession', () => {
  it('依時間分進對應時段，組內順序維持輸入順序', () => {
    const morning = apt({ _id: 'm', scheduledAt: '2026-08-26T10:00:00' });
    const duringSurgery = apt({ _id: 's', scheduledAt: '2026-08-26T12:30:00' });
    const afternoon = apt({ _id: 'a', scheduledAt: '2026-08-26T15:00:00' });
    const groups = groupBySession([morning, duringSurgery, afternoon]);
    assert.equal(groups.length, SESSIONS.length);
    assert.deepEqual(groups[0].items.map((item) => item._id), ['m']);
    // 手術時間掛號併入下午診，跟真正下午診的項目同一組。
    assert.deepEqual(groups[1].items.map((item) => item._id), ['s', 'a']);
  });
});

describe('nowIndexInSession', () => {
  it('插在第一筆「還沒到時間」的項目前面', () => {
    const items = [
      apt({ _id: 'a', scheduledAt: '2026-08-26T10:00:00' }),
      apt({ _id: 'b', scheduledAt: '2026-08-26T10:20:00' }),
      apt({ _id: 'c', scheduledAt: '2026-08-26T11:00:00' }),
    ];
    const now = new Date('2026-08-26T10:45:00');
    assert.equal(nowIndexInSession(items, now), 2);
  });

  it('比全部項目都早就插在最前面，比全部項目都晚就插在最後面', () => {
    const items = [apt({ scheduledAt: '2026-08-26T10:00:00' }), apt({ scheduledAt: '2026-08-26T11:00:00' })];
    assert.equal(nowIndexInSession(items, new Date('2026-08-26T09:00:00')), 0);
    assert.equal(nowIndexInSession(items, new Date('2026-08-26T12:00:00')), 2);
  });
});
