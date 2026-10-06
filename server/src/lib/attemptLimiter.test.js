import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createAttemptLimiter } from './attemptLimiter.js';

const MINUTE = 60 * 1000;
const NOW = Date.UTC(2026, 0, 1);

function failTimes(limiter, key, times, now = NOW) {
  for (let index = 0; index < times; index += 1) limiter.recordFailure(key, now);
}

describe('createAttemptLimiter', () => {
  it('失敗次數未達上限時不擋', () => {
    const limiter = createAttemptLimiter({ max: 3, windowMs: 15 * MINUTE });
    failTimes(limiter, 'ip', 2);
    assert.equal(limiter.retryAfterSeconds('ip', NOW), 0);
  });

  it('達到上限後擋到視窗結束，並回報還要等多久', () => {
    const limiter = createAttemptLimiter({ max: 3, windowMs: 15 * MINUTE });
    failTimes(limiter, 'ip', 3);
    assert.equal(limiter.retryAfterSeconds('ip', NOW), 15 * 60);
    assert.equal(limiter.retryAfterSeconds('ip', NOW + 14 * MINUTE), 60);
  });

  // 被擋的期間繼續嘗試不會把解鎖時間往後推 —— 視窗是從第一次失敗起算的。
  it('鎖定期間繼續失敗不會延長鎖定', () => {
    const limiter = createAttemptLimiter({ max: 3, windowMs: 15 * MINUTE });
    failTimes(limiter, 'ip', 3);
    failTimes(limiter, 'ip', 5, NOW + 10 * MINUTE);
    assert.equal(limiter.retryAfterSeconds('ip', NOW + 15 * MINUTE), 0);
  });

  it('視窗過期後重新計數', () => {
    const limiter = createAttemptLimiter({ max: 3, windowMs: 15 * MINUTE });
    failTimes(limiter, 'ip', 3);
    const later = NOW + 15 * MINUTE;
    failTimes(limiter, 'ip', 2, later);
    assert.equal(limiter.retryAfterSeconds('ip', later), 0);
  });

  it('不同來源各自計數', () => {
    const limiter = createAttemptLimiter({ max: 3, windowMs: 15 * MINUTE });
    failTimes(limiter, 'attacker', 3);
    assert.equal(limiter.retryAfterSeconds('someone-else', NOW), 0);
  });

  it('reset 之後從零開始', () => {
    const limiter = createAttemptLimiter({ max: 3, windowMs: 15 * MINUTE });
    failTimes(limiter, 'ip', 2);
    limiter.reset('ip');
    failTimes(limiter, 'ip', 2);
    assert.equal(limiter.retryAfterSeconds('ip', NOW), 0);
  });

  // 來源數量不受我們控制，紀錄不能無限長大。
  it('紀錄筆數到上限時丟掉最舊的，新的來源仍會被記到', () => {
    const limiter = createAttemptLimiter({ max: 1, windowMs: 15 * MINUTE, maxEntries: 2 });
    limiter.recordFailure('first', NOW);
    limiter.recordFailure('second', NOW);
    limiter.recordFailure('third', NOW);
    assert.equal(limiter.retryAfterSeconds('first', NOW), 0);
    assert.ok(limiter.retryAfterSeconds('second', NOW) > 0);
    assert.ok(limiter.retryAfterSeconds('third', NOW) > 0);
  });
});
