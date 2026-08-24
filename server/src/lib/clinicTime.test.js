import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clinicDayStart, clinicToday, combineClinicDateTime } from './clinicTime.js';

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

describe('combineClinicDateTime', () => {
  it('把日期＋時間換算成台北時區對應的時刻', () => {
    // 8/20 16:30 台北 = 8/20 08:30Z。
    assert.equal(combineClinicDateTime('2026-08-20', '16:30').toISOString(), '2026-08-20T08:30:00.000Z');
  });

  it('沒填時間時等同當天午夜', () => {
    assert.equal(combineClinicDateTime('2026-08-20', '').toISOString(), clinicDayStart('2026-08-20').toISOString());
    assert.equal(combineClinicDateTime('2026-08-20', undefined).toISOString(), clinicDayStart('2026-08-20').toISOString());
  });

  it('日期不合法就回傳 null，呼叫端當作沒有這個條件', () => {
    assert.equal(combineClinicDateTime('not-a-date', '10:00'), null);
    assert.equal(combineClinicDateTime('', '10:00'), null);
  });
});

describe('clinicToday', () => {
  it('回傳台北時區的當天日期字串', () => {
    // 台北 8/20 08:00 = UTC 8/20 00:00，兩邊都還是同一個台北日期。
    assert.equal(clinicToday(new Date('2026-08-20T00:00:00.000Z')), '2026-08-20');
    // UTC 8/19 20:00 已經是台北 8/20 04:00，仍然算 8/20。
    assert.equal(clinicToday(new Date('2026-08-19T20:00:00.000Z')), '2026-08-20');
    // UTC 8/19 15:00 還是台北 8/19 23:00，算前一天。
    assert.equal(clinicToday(new Date('2026-08-19T15:00:00.000Z')), '2026-08-19');
  });
});
