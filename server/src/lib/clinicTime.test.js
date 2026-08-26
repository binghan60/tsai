import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clinicDayStart } from './clinicTime.js';

// 這裡釘住的是「使用者挑的那一天」與「資料庫裡的時刻」之間的換算。
// 算錯的後果很安靜：流水帳查 8/20 卻漏掉台北時間 8/20 凌晨到早上八點寄出的那幾封，
// 畫面上不會有任何錯誤，只是筆數少了。

describe('clinicDayStart', () => {
  it('把日期換算成台北當天午夜，而不是 UTC 午夜', () => {
    // 台北是 UTC+8，所以 8/20 00:00 台北 = 8/19 16:00Z。
    assert.equal(clinicDayStart('2026-08-20').toISOString(), '2026-08-19T16:00:00.000Z');
  });

  it('dayOffset 取到隔天的開頭，用來當區間上界', () => {
    assert.equal(clinicDayStart('2026-08-20', 1).toISOString(), '2026-08-20T16:00:00.000Z');
  });

  it('跨月與跨年都由 Date.UTC 進位處理', () => {
    assert.equal(clinicDayStart('2026-08-31', 1).toISOString(), '2026-08-31T16:00:00.000Z');
    assert.equal(clinicDayStart('2026-12-31', 1).toISOString(), '2026-12-31T16:00:00.000Z');
  });

  it('不是 YYYY-MM-DD 就回傳 null，讓呼叫端當作沒有這個條件', () => {
    assert.equal(clinicDayStart(''), null);
    assert.equal(clinicDayStart(undefined), null);
    assert.equal(clinicDayStart('2026/08/20'), null);
    assert.equal(clinicDayStart('not-a-date'), null);
  });
});
