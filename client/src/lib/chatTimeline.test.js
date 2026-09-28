import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chatDayLabel, chatTimeLabel, chatTimeline } from './chatTimeline.js';

// 診所時區 2026-09-28 12:00（台北）。
const now = new Date('2026-09-28T04:00:00Z');

describe('chat timeline', () => {
  it('日期分隔：今天、昨天、同年寫月日星期、跨年加年份', () => {
    assert.equal(chatDayLabel('2026-09-28', now), '今天');
    assert.equal(chatDayLabel('2026-09-27', now), '昨天');
    assert.equal(chatDayLabel('2026-09-26', now), '9/26（週六）');
    assert.equal(chatDayLabel('2025-12-31', now), '2025/12/31（週三）');
  });

  it('訊息時間：今天只寫時間，其他帶日期', () => {
    assert.equal(chatTimeLabel('2026-09-28T01:05:00Z', now), '09:05');
    assert.equal(chatTimeLabel('2026-09-27T06:30:00Z', now), '昨天 14:30');
    assert.equal(chatTimeLabel('2026-09-01T06:30:00Z', now), '9/1 14:30');
    assert.equal(chatTimeLabel('2025-12-31T06:30:00Z', now), '2025/12/31 14:30');
    assert.equal(chatTimeLabel('', now), '');
  });

  it('日期以診所時區算：UTC 前一天晚上 17:00 已經是台北的隔天', () => {
    assert.equal(chatTimeLabel('2026-09-27T17:00:00Z', now), '01:00');
  });

  it('每一天的第一則前面插一條分隔，同一天不重複', () => {
    const rows = chatTimeline([
      { _id: 'a', createdAt: '2026-09-26T02:00:00Z' },
      { _id: 'b', createdAt: '2026-09-26T09:00:00Z' },
      { _id: 'c', createdAt: '2026-09-28T01:00:00Z' },
    ], now);
    assert.deepEqual(rows.map((row) => (row.type === 'day' ? row.label : row.key)), ['9/26（週六）', 'a', 'b', '今天', 'c']);
    assert.deepEqual(chatTimeline([], now), []);
  });
});
