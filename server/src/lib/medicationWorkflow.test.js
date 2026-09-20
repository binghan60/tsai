import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import MedicationOrder from '../models/MedicationOrder.js';
import { applyMedicationAction, medicationFields } from './medicationWorkflow.js';

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
