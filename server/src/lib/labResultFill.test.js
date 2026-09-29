import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseIdexxResult } from './idexxResult.js';
import { petIdFromPatientId, pickVisit, planLabFill } from './labResultFill.js';

const catalyst = parseIdexxResult(readFileSync(new URL('../../test/fixtures/idexx/catalyst-one.xml', import.meta.url)));
const earCytology = parseIdexxResult(readFileSync(new URL('../../test/fixtures/idexx/invue-ear-cytology.xml', import.meta.url)));

const labItem = (key, label, idexxCodes) => ({ key, label, type: 'lab', idexxCodes });

describe('petIdFromPatientId：結果是哪隻貓', () => {
  it('報到時送出去的貓咪 _id 原樣帶回來', () => {
    assert.equal(petIdFromPatientId('64b000000000000000000001'), '64b000000000000000000001');
    assert.equal(petIdFromPatientId(' 64B000000000000000000001 '), '64B000000000000000000001');
  });

  it('IDEXX 主機上手動新增的病患（空字串）或別的編號都不算', () => {
    assert.equal(petIdFromPatientId(''), null);
    assert.equal(petIdFromPatientId('000001'), null);
    assert.equal(petIdFromPatientId(undefined), null);
  });
});

describe('pickVisit：是哪一次看診', () => {
  const runAt = new Date('2026-09-30T03:00:00Z');

  it('當天只有一筆就是它', () => {
    assert.equal(pickVisit([{ _id: 'a', status: 'arrived' }], runAt)._id, 'a');
  });

  it('取消與未到的不算', () => {
    assert.equal(pickVisit([{ _id: 'a', status: 'cancelled' }, { _id: 'b', status: 'no_show' }], runAt), null);
    assert.equal(pickVisit([{ _id: 'a', status: 'cancelled' }, { _id: 'b', status: 'arrived' }], runAt)._id, 'b');
  });

  it('好幾筆時挑檢驗之前最後報到的那一筆', () => {
    const visits = [
      { _id: 'morning', status: 'completed', checkedInAt: new Date('2026-09-30T01:00:00Z') },
      { _id: 'noon', status: 'arrived', checkedInAt: new Date('2026-09-30T02:30:00Z') },
      { _id: 'later', status: 'arrived', checkedInAt: new Date('2026-09-30T05:00:00Z') },
    ];
    assert.equal(pickVisit(visits, runAt)._id, 'noon');
  });

  it('好幾筆但都還沒報到就不猜', () => {
    assert.equal(pickVisit([{ _id: 'a', status: 'scheduled' }, { _id: 'b', status: 'scheduled' }], runAt), null);
  });
});

describe('planLabFill：填哪些格子', () => {
  const items = [
    labItem('glucose', '血糖（GLU）', ['GLU']),
    labItem('bun', '腎臟功能（BUN）', ['bun']),
    labItem('cre', '腎臟功能（CRE）', ['CREA']),
    labItem('albumin', '肝臟功能（ALB）', ['ALB']),
  ];

  it('空的格子填 IDEXX 的值，代號不分大小寫；表單沒有的項目列為未對應', () => {
    const plan = planLabFill(catalyst.assays, items, []);
    assert.deepEqual(plan.fill, { glucose: '117', bun: '25', cre: '1.7' });
    assert.deepEqual(plan.unmapped, ['SDMA']);
    assert.deepEqual(plan.conflicts, []);
  });

  it('已經有一樣的值就不動；不一樣的不蓋掉，記下來讓醫師決定', () => {
    const plan = planLabFill(catalyst.assays, items, [
      { key: 'glucose', value: '117' },
      { key: 'cre', value: '1.5' },
    ]);
    assert.deepEqual(plan.fill, { bun: '25' });
    assert.deepEqual(plan.conflicts, [{ key: 'cre', label: '腎臟功能（CRE）', current: '1.5', idexx: '1.7' }]);
  });

  it('儀器判定無效的結果不填（inVue 因檢體品質壓掉的項目）', () => {
    const plan = planLabFill(earCytology.assays, [labItem('yeast_right', '右耳酵母菌', ['YEA_RIGHT']), labItem('mite_right', '右耳耳疥蟲', ['MITE_RIGHT'])], []);
    assert.deepEqual(plan.fill, { mite_right: 'Absent' });
  });

  it('同一個項目有兩個代號都出現時以先出現的為準', () => {
    const assays = [{ code: 'RBC', value: '5.1', qualifier: '=' }, { code: 'RBC_BLD', value: '5.0', qualifier: '=' }];
    const plan = planLabFill(assays, [labItem('rbc', '紅血球', ['RBC', 'RBC_BLD'])], []);
    assert.deepEqual(plan.fill, { rbc: '5.1' });
  });

  it('超過欄位長度上限的結果不填（整句判讀放不進看診的檢驗欄位）', () => {
    const plan = planLabFill([{ code: 'PLT_EST', value: 'x'.repeat(41), qualifier: '=' }], [labItem('plt', '血小板', ['PLT_EST'])], []);
    assert.deepEqual(plan.fill, {});
  });

  it('表單沒設任何代號時什麼都不填', () => {
    const plan = planLabFill(catalyst.assays, [labItem('glucose', '血糖', [])], []);
    assert.deepEqual(plan.fill, {});
    assert.equal(plan.unmapped.length, 4);
  });
});
