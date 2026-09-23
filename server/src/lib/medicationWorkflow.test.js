import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import MedicationOrder from '../models/MedicationOrder.js';
import { applyMedicationAction, applyMedicationJournalEdit, medicationFields, medicationJournalContent } from './medicationWorkflow.js';

function order() {
  return { status: 'review', condition: '食慾正常', prescription: '原藥單', note: '', __v: 0, history: [] };
}
function action(item, name, fields = {}, actor = '測試人員') {
  applyMedicationAction(item, name, { version: item.__v, ...fields }, actor);
  item.__v += 1;
}
describe('領藥狀態與藥單版本', () => {
  it('登記後須由醫師確認，再依序包藥、待領、已領藥，保留每次內容與操作人', () => {
    const item = order();
    assert.throws(() => action(item, 'ready'), { status: 409 });
    action(item, 'approve', { prescription: '醫師修改後的藥單' }, '醫師');
    assert.equal(item.approvedBy, '醫師');
    assert.throws(() => action(item, 'collect'), { status: 409 });
    action(item, 'ready', {}, '包藥人員');
    action(item, 'collect', {}, '櫃檯');
    assert.equal(item.status, 'collected');
    assert.equal(item.packedBy, '包藥人員');
    assert.ok(item.collectedAt);
    assert.deepEqual(item.history.map(entry => entry.actor), ['醫師', '包藥人員', '櫃檯']);
    assert.equal(item.history[0].prescription, '醫師修改後的藥單');
    assert.throws(() => action(item, 'edit', { prescription: '不得修改' }), { status: 409 });
  });
  for (const stage of ['approved', 'ready']) {
    it(`${stage} 修改後使醫師確認失效，已完成包藥則強制確認重包`, () => {
      const item = order();
      action(item, 'approve');
      if (stage === 'ready') action(item, 'ready');
      const staleVersion = item.__v;
      action(item, 'edit', { prescription: '新藥單' });
      assert.equal(item.status, 'review');
      assert.equal(item.approvedAt, null);
      assert.equal(item.needsRepack, stage !== 'approved');
      assert.throws(() => applyMedicationAction(item, 'ready', { version: staleVersion }, '另一人'), { status: 409 });
      action(item, 'approve');
      if (stage === 'ready') assert.throws(() => action(item, 'ready'), { status: 422 });
      action(item, 'ready', { acknowledgeRepack: true });
      assert.equal(item.needsRepack, false);
      assert.equal(item.status, 'ready');
    });
  }
  it('內容沒有實際變更的 edit 不取消醫師確認；包藥時不能夾帶處方修改', () => {
    const item = order();
    action(item, 'approve'); action(item, 'ready');
    // 前端自動送出時常常整包欄位一起帶，內容跟現況相同就不該把藥單打回重審。
    action(item, 'edit', { condition: '食慾正常', note: '' });
    assert.equal(item.status, 'ready');
    assert.throws(() => action(item, 'collect', { prescription: '未審核內容' }), { status: 409 });
    assert.equal(item.prescription, '原藥單');
  });
  it('不接受空白藥單確認、無版本操作及取消後再包藥', () => {
    const item = order(); item.prescription = '';
    assert.throws(() => action(item, 'approve'), { status: 422 });
    assert.throws(() => applyMedicationAction(item, 'edit', {}, '測試'), { status: 409 });
    action(item, 'cancel');
    assert.equal(item.history.at(-1).reason, '');
    assert.throws(() => action(item, 'ready'), { status: 409 });
  });
  it('櫃檯可附上意見退回醫師重新審核', () => {
    const item = order();
    action(item, 'approve', {}, '醫師');
    action(item, 'return', { reason: '劑量請再確認' }, '櫃檯');
    assert.equal(item.status, 'review');
    assert.equal(item.approvedAt, null);
    assert.equal(item.approvedBy, '');
    assert.equal(item.history.at(-1).reason, '劑量請再確認');
  });
  it('拒絕錯誤型別、超長文字，忽略客戶端指定狀態與確認人', () => {
    assert.throws(() => medicationFields({ prescription: {} }), { status: 422 });
    assert.throws(() => medicationFields({ condition: 'x'.repeat(5001) }), { status: 422 });
    assert.deepEqual(medicationFields({ note: ' 備註 ', status: 'approved', approvedBy: '偽造' }), { note: '備註' });
    assert.equal(MedicationOrder.schema.options.optimisticConcurrency, true);
  });
});

describe('領藥紀錄的病歷日誌內文', () => {
  it('標題帶目前階段，依序列出病況、藥單、備註，空欄位不出現', () => {
    assert.equal(
      medicationJournalContent({ status: 'review', condition: '食慾差', prescription: '抗生素 每日兩次', note: '' }),
      '領藥（待醫師確認）\n\n病況：食慾差\n\n藥單：抗生素 每日兩次'
    );
    assert.equal(medicationJournalContent({ status: 'approved', condition: '  ', prescription: '', note: '飼主要求磨粉' }), '領藥（待包藥）\n\n備註：飼主要求磨粉');
  });

  it('已領藥會在標題帶診所時區的領藥時間，其他階段不帶', () => {
    // 2026-09-22T06:30Z ＝ 台北 14:30
    const collected = medicationJournalContent({ status: 'collected', prescription: '藥', collectedAt: '2026-09-22T06:30:00Z' });
    assert.match(collected.split('\n')[0], /^領藥（已領藥 9\/22 14:30）$/);
    assert.equal(medicationJournalContent({ status: 'ready', prescription: '藥', collectedAt: '2026-09-22T06:30:00Z' }).split('\n')[0], '領藥（待領藥）');
  });
});

describe('從病歷日誌更正藥單', () => {
  it('已領藥的藥單直接更正內容、不動階段，並留下 journal_edit 軌跡', () => {
    const item = { ...order(), status: 'collected', history: [{ action: 'approve' }] };
    assert.equal(applyMedicationJournalEdit(item, { note: ' 飼主說藥粉太苦 ' }, '醫師'), true);
    assert.equal(item.status, 'collected');
    assert.equal(item.note, '飼主說藥粉太苦');
    assert.deepEqual({ ...item.history.at(-1), at: undefined }, {
      action: 'journal_edit', actor: '醫師', at: undefined, from: 'collected', to: 'collected', reason: '',
      condition: '食慾正常', prescription: '原藥單', note: '飼主說藥粉太苦',
    });
  });

  it('還在流程中的藥單改了內容就退回待醫師確認，已包好的要重新包藥', () => {
    const item = { ...order(), status: 'ready', approvedAt: new Date(), approvedBy: '醫師', packedAt: new Date(), packedBy: '櫃台' };
    applyMedicationJournalEdit(item, { prescription: '新藥單' }, '醫師');
    assert.equal(item.status, 'review');
    assert.equal(item.needsRepack, true);
    assert.equal(item.approvedAt, null);
    assert.equal(item.packedAt, null);
  });

  it('沒有實際變動不留軌跡；不能清空藥單；已取消的不能改', () => {
    const item = order();
    assert.equal(applyMedicationJournalEdit(item, { prescription: '原藥單' }, '醫師'), false);
    assert.equal(item.history.length, 0);
    assert.throws(() => applyMedicationJournalEdit(order(), { prescription: '  ' }, '醫師'), /不能清空/);
    assert.throws(() => applyMedicationJournalEdit({ ...order(), status: 'cancelled' }, { note: 'x' }, '醫師'), /已取消/);
  });
});
