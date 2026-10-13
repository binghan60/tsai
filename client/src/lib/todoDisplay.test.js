import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dueStatus, todoMatches } from './todoDisplay.js';

describe('todo due status', () => {
  const today = '2026-09-22';

  it('逾期、今天、明天、之後各自標示', () => {
    assert.deepEqual(dueStatus('2026-09-20', today), { tone: 'danger', label: '逾期 2 天', overdue: true });
    assert.deepEqual(dueStatus('2026-09-22', today), { tone: 'warning', label: '今天', overdue: false });
    assert.deepEqual(dueStatus('2026-09-23', today), { tone: 'info', label: '明天', overdue: false });
    assert.deepEqual(dueStatus('2026-10-05', today), { tone: 'info', label: '10/5', overdue: false });
  });

  it('跨月跨年的天數不受月長影響', () => {
    assert.equal(dueStatus('2026-08-31', '2026-09-01').label, '逾期 1 天');
    assert.equal(dueStatus('2025-12-31', '2026-01-01').label, '逾期 1 天');
    assert.equal(dueStatus('2026-01-01', '2025-12-31').label, '明天');
  });

  it('沒有期限或日期讀不懂就不出徽章', () => {
    assert.equal(dueStatus(null, today), null);
    assert.equal(dueStatus('', today), null);
    assert.equal(dueStatus('明天', today), null);
  });

});

describe('todo search', () => {
  const item = { content: '叫貨：**腎臟處方飼料 k/d** 3 包', progress: '已訂，週五到', mentions: [{ petName: '雪球' }] };
  it('比對去掉格式標記的內文、處理過程、貓咪名字，不分大小寫', () => {
    assert.equal(todoMatches(item, '飼料 K/D'), true);
    assert.equal(todoMatches(item, '週五'), true);
    assert.equal(todoMatches(item, '雪球'), true);
    assert.equal(todoMatches(item, '**'), false);
    assert.equal(todoMatches(item, '阿虎'), false);
  });
  it('空白關鍵字全部符合', () => {
    assert.equal(todoMatches(item, '  '), true);
  });
});
