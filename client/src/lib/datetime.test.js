import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ageLabel, clinicDateInput, shiftDateInput, weekdayLabel, startOfWeek } from './datetime.js';

describe('clinic date helpers', () => {
  it('uses the Taipei calendar day around UTC midnight', () => {
    assert.equal(clinicDateInput('2026-08-21T16:30:00.000Z'), '2026-08-22');
  });

  it('calculates age against the visit date instead of the current clock', () => {
    assert.equal(ageLabel('2025-06-15T00:00:00.000Z', '2026-08-14T00:00:00.000Z'), '1 歲 1 個月');
  });
});

describe('shiftDateInput', () => {
  it('往前往後都在同一種格式上加減整數天', () => {
    assert.equal(shiftDateInput('2026-08-27', 1), '2026-08-28');
    assert.equal(shiftDateInput('2026-08-27', -1), '2026-08-26');
    assert.equal(shiftDateInput('2026-08-27', 0), '2026-08-27');
  });

  // 全程只在 UTC 上做整數日加減，跨月、跨年、閏日都交給 Date.UTC 處理。
  it('跨月、跨年與閏日都不會算錯', () => {
    assert.equal(shiftDateInput('2026-08-31', 1), '2026-09-01');
    assert.equal(shiftDateInput('2026-01-01', -1), '2025-12-31');
    assert.equal(shiftDateInput('2028-02-28', 1), '2028-02-29');
  });

  it('格式不對就回空字串，不要吐出 Invalid Date', () => {
    assert.equal(shiftDateInput('', 1), '');
    assert.equal(shiftDateInput('2026/08/27', 1), '');
    assert.equal(shiftDateInput(undefined, 1), '');
  });
});

describe('weekdayLabel', () => {
  it('讀的是傳進來的那一天，不受時區影響', () => {
    assert.equal(weekdayLabel('2026-08-27'), '週四');
    assert.equal(weekdayLabel('2026-08-30'), '週日');
  });

  it('格式不對就回 fallback', () => {
    assert.equal(weekdayLabel('', '—'), '—');
    assert.equal(weekdayLabel('not-a-date', '—'), '—');
  });
});

describe('startOfWeek', () => {
  it('回傳 ISO 週制的週一（預設）', () => {
    // 2026-08-27 是週四，週一應該是 2026-08-24
    assert.equal(startOfWeek('2026-08-27'), '2026-08-24');
    // 2026-08-24 本身是週一
    assert.equal(startOfWeek('2026-08-24'), '2026-08-24');
    // 2026-08-30 是週日，週一應該是 2026-08-24（同一週）
    assert.equal(startOfWeek('2026-08-30'), '2026-08-24');
  });

  it('跨月邊界不會算錯', () => {
    // 2026-09-01 是週二，週一應該是 2026-08-31
    assert.equal(startOfWeek('2026-09-01'), '2026-08-31');
  });

  it('支援美式週日開始（weekStartsOn=0）', () => {
    // 2026-08-27 是週四，美式週首（週日）應該是 2026-08-23
    assert.equal(startOfWeek('2026-08-27', 0), '2026-08-23');
  });

  it('格式不對就回空字串', () => {
    assert.equal(startOfWeek('', ''), '');
    assert.equal(startOfWeek('2026/08/27', ''), '');
  });
});
