import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { composeYearMonth, parseYearMonth } from './yearMonth.js';

describe('yearMonth', () => {
  it('組成與解析互為反函數', () => {
    assert.equal(composeYearMonth('2026', '1'), '2026 年 1 月');
    assert.equal(composeYearMonth('2026', ''), '2026 年');
    assert.equal(composeYearMonth('', '3'), '');
    assert.deepEqual(parseYearMonth('2026 年 1 月'), { year: '2026', month: '1' });
    assert.deepEqual(parseYearMonth('2026 年'), { year: '2026', month: '' });
  });

  it('看不懂的舊資料回傳 null', () => {
    assert.equal(parseYearMonth(''), null);
    assert.equal(parseYearMonth('8/10'), null);
    assert.equal(parseYearMonth('2026 年 13 月'), null);
  });
});
