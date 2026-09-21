import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dueStatus, overdueCount } from './todoDisplay.js';

describe('todo due status', () => {
  const today = '2026-09-22';

  it('逾期、今天、明天、之後各自標示', () => {
    assert.deepEqual(dueStatus('2026-09-20', today), { tone: 'danger', label: '逾期 2 天', overdue: true });
    assert.deepEqual(dueStatus('2026-09-22', today), { tone: 'warning', label: '今天', overdue: false });
    assert.deepEqual(dueStatus('2026-09-23', today), { tone: 'neutral', label: '明天', overdue: false });
    assert.deepEqual(dueStatus('2026-10-05', today), { tone: 'neutral', label: '10/5', overdue: false });
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

  it('逾期筆數只算未完成的', () => {
    const items = [
      { status: 'open', dueDate: '2026-09-01' },
      { status: 'open', dueDate: '2026-09-30' },
      { status: 'open', dueDate: null },
      { status: 'done', dueDate: '2026-09-01' },
    ];
    assert.equal(overdueCount(items, today), 1);
  });
});
