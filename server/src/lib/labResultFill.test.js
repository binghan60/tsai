import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseIdexxResult } from './idexxResult.js';
import { liveConflicts, overwriteValues, petIdFromPatientId, pickVisit, planLabFill, planUndo, rankCandidates, sameName, unmappedLabel } from './labResultFill.js';

describe('數值差異：比對視窗', () => {
  const conflicts = [
    { key: 'cre', label: 'CRE', current: '1.5', idexx: '1.7' },
    { key: 'glucose', label: '血糖', current: '110', idexx: '117' },
    { key: 'alt', label: 'ALT', current: '45', idexx: '54' },
  ];

  it('用報告上現在的值重新比：已經改成跟 IDEXX 一樣的不列，被清空的列成空白', () => {
    const current = [{ key: 'cre', value: '1.6' }, { key: 'glucose', value: '117' }];
    assert.deepEqual(liveConflicts(conflicts, current), [
      { key: 'cre', label: 'CRE', current: '1.6', idexx: '1.7' },
      { key: 'alt', label: 'ALT', current: '', idexx: '54' },
    ]);
  });

  it('覆蓋只收這份結果真的有差異的欄位，前端送別的 key 忽略', () => {
    assert.deepEqual(overwriteValues(conflicts, ['cre', 'alt', 'weight']), { cre: '1.7', alt: '54' });
    assert.deepEqual(overwriteValues(conflicts, []), {});
    assert.deepEqual(overwriteValues(conflicts, 'cre'), {});
  });
});

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

describe('待確認清單：候選與復原', () => {
  it('同名比對去掉空白、不分大小寫；空名字不算同名', () => {
    assert.equal(sameName('Mi Mi', 'mimi'), true);
    assert.equal(sameName('牛奶', ' 牛 奶 '), true);
    assert.equal(sameName('', ''), false);
    assert.equal(sameName('牛奶', '咖啡'), false);
  });

  it('候選排除取消、未到、還沒建檔的；同名排前面，其餘依時段', () => {
    const visits = [
      { _id: 'a', petId: 'p1', petName: '咖啡', time: '09:00', status: 'arrived' },
      { _id: 'b', petId: 'p2', petName: '牛奶', time: '15:00', status: 'arrived' },
      { _id: 'c', petId: 'p3', petName: '豆豆', time: '10:00', status: 'cancelled' },
      { _id: 'd', petId: null, petName: '初診', time: '11:00', status: 'scheduled' },
      { _id: 'e', petId: 'p4', petName: '小白', time: '08:00', status: 'completed' },
    ];
    const ranked = rankCandidates(visits, '牛奶');
    assert.deepEqual(ranked.map((candidate) => candidate.appointmentId), ['b', 'e', 'a']);
    assert.equal(ranked[0].suggested, true);
    assert.equal(ranked[1].suggested, false);
  });

  it('同名的不只一隻就不預選', () => {
    const visits = [
      { _id: 'a', petId: 'p1', petName: '咪咪', time: '09:00', status: 'arrived' },
      { _id: 'b', petId: 'p2', petName: '咪咪', time: '15:00', status: 'arrived' },
    ];
    assert.deepEqual(rankCandidates(visits, '咪咪').map((candidate) => candidate.suggested), [false, false]);
  });

  it('復原只清還是當初填的值的欄位，被人改過的留著', () => {
    const filled = [
      { key: 'glucose', label: '血糖', value: '117' },
      { key: 'bun', label: 'BUN', value: '25' },
      { key: 'cre', label: 'CRE', value: '1.7' },
    ];
    const current = [
      { key: 'glucose', value: '117' },
      { key: 'bun', value: '30' },
    ];
    assert.deepEqual(planUndo(current, filled), { clear: ['glucose'], kept: ['BUN'] });
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

describe('planLabFill：同一個代號在不同檢驗別', () => {
  const assays = [{ code: 'RBC', value: '5.1', qualifier: '=' }];
  const byInstrument = [
    { ...labItem('rbc_blood', '紅血球（血球機）', ['RBC']), idexxInstrument: 'Catalyst_One' },
    { ...labItem('rbc_invue', '紅血球（inVue）', ['RBC']), idexxInstrument: 'IDEXX_inVue_Dx' },
  ];

  it('依儀器填進對應的項目，不會填到另一台的格子', () => {
    assert.deepEqual(planLabFill(assays, byInstrument, [], 'Catalyst_One').fill, { rbc_blood: '5.1' });
    assert.deepEqual(planLabFill(assays, byInstrument, [], 'IDEXX_inVue_Dx').fill, { rbc_invue: '5.1' });
  });

  it('檢驗別比對不分大小寫，底線與空白視為相同', () => {
    assert.deepEqual(planLabFill(assays, byInstrument, [], 'catalyst one').fill, { rbc_blood: '5.1' });
    assert.deepEqual(planLabFill(assays, byInstrument, [], 'idexx inVue dx').fill, { rbc_invue: '5.1' });
  });

  it('沒有任何項目的檢驗別對得上，就列為未對應', () => {
    const plan = planLabFill(assays, byInstrument, [], 'SNAP');
    assert.deepEqual(plan.fill, {});
    assert.deepEqual(plan.unmapped, ['SNAP・RBC']);
  });

  it('檢驗別留空的項目任何儀器都對；有指定檢驗別的優先', () => {
    const anyInstrument = labItem('rbc_any', '紅血球', ['RBC']);
    assert.deepEqual(planLabFill(assays, [anyInstrument], [], 'SNAP').fill, { rbc_any: '5.1' });
    const plan = planLabFill(assays, [anyInstrument, ...byInstrument], [], 'Catalyst_One');
    assert.deepEqual(plan.fill, { rbc_blood: '5.1' });
  });
});

describe('unmappedLabel：未對應要帶儀器名稱', () => {
  it('有檢驗別就寫「檢驗別・代號」，沒有就只寫代號', () => {
    assert.equal(unmappedLabel('Catalyst_One', 'RBC'), 'Catalyst_One・RBC');
    assert.equal(unmappedLabel('', 'RBC'), 'RBC');
    assert.equal(unmappedLabel(undefined, 'RBC'), 'RBC');
  });
});
