import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { labFillStatus } from './labFillStatus.js';

const visit = 'a1';
const result = (extra = {}) => ({
  _id: 'r1', appointmentId: visit, instrument: 'Catalyst_One', runAt: '2026-10-07T06:32:00Z', appliedAt: '2026-10-07T06:33:00Z',
  filled: [], unmappedCodes: [], fillClosed: null, ...extra,
});
const status = (results, conflictGroups = []) => labFillStatus({ results, conflictGroups, appointmentId: visit, baseDate: '2026-10-07' });

describe('labFillStatus：IDEXX 結果的填入狀態燈號', () => {
  it('沒有連到這次看診的結果：不畫', () => {
    assert.equal(status([]).tone, null);
    assert.equal(status([result({ appointmentId: 'other' })]).tone, null);
    assert.equal(status([result({ appointmentId: null })]).tone, null);
  });

  it('有填入、沒有待處理的事：綠燈，寫填了幾項', () => {
    const value = status([
      result({ filled: [{ key: 'bun', label: 'BUN', value: '25' }, { key: 'cre', label: 'CRE', value: '1.8' }] }),
      result({ _id: 'r2', instrument: 'ProCyte_Dx', filled: [{ key: 'wbc', label: 'WBC', value: '9.1' }] }),
    ]);
    assert.equal(value.tone, 'success');
    assert.equal(value.text, '已填入 3 項');
    assert.deepEqual(value.sections.map((section) => section.title), ['生化 Catalyst One', '血球 ProCyte Dx']);
    assert.equal(value.sections[0].time, '14:32');
  });

  it('表單沒有對應欄位不算黃燈，只在明細列出', () => {
    const value = status([result({ filled: [{ key: 'bun', label: 'BUN', value: '25' }], unmappedCodes: ['Catalyst_One・ALT', 'Catalyst_One・TP'] })]);
    assert.equal(value.tone, 'success');
    assert.deepEqual(value.sections[0].unmapped, ['Catalyst_One・ALT', 'Catalyst_One・TP']);
  });

  it('一項都沒填、也沒有要處理的：藍燈', () => {
    const value = status([result({ unmappedCodes: ['SNAP・FeLV'] })]);
    assert.equal(value.tone, 'info');
    assert.equal(value.text, '沒有填入新的數值');
  });

  it('還沒處理的數值差異：黃燈，用伺服器重算過的那份，帶著比對視窗要的 group', () => {
    const group = { id: 'r1', items: [{ key: 'cre', label: 'CRE', current: '1.5', idexx: '1.7' }] };
    const value = status([result({ filled: [{ key: 'bun', label: 'BUN', value: '25' }], conflicts: [{ key: 'old' }, { key: 'stale' }] })], [group]);
    assert.equal(value.tone, 'warning');
    assert.equal(value.text, '1 項跟報告不同');
    assert.equal(value.sections[0].group, group);
    // 結果上存的 conflicts 可能過時，沒有對應的 group 就不算。
    assert.equal(status([result({ conflicts: [{ key: 'old' }] })]).tone, 'info');
  });

  it('看診沒選健檢表單：黃燈', () => {
    const value = status([result({ appliedAt: null })]);
    assert.equal(value.tone, 'warning');
    assert.equal(value.text, '沒選健檢表單，數值沒有進報告');
  });

  it('填入時報告已結案：黃燈；櫃台已完成處理不算', () => {
    const filled = [{ key: 'bun', label: 'BUN', value: '25' }];
    assert.equal(status([result({ filled, fillClosed: 'record_finalized' })]).text, '報告已結案，數值沒有進報告');
    assert.equal(status([result({ filled, fillClosed: 'desk_completed' })]).tone, 'success');
  });

  it('別天匯入的結果時間連日期一起寫', () => {
    assert.equal(status([result({ runAt: '2026-10-06T02:00:00Z' })]).sections[0].time, '2026-10-06 10:00');
  });
});
