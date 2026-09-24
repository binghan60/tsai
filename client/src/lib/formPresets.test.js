import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planPresetApplication, sameValue } from './formPresets.js';

const items = [
  { key: 'reason', type: 'text', defaultValue: '例行健檢' },
  { key: 'vaccine', type: 'select', options: ['三合一', '狂犬病'] },
  { key: 'teeth', type: 'textarea' },
  { key: 'signs', type: 'checkbox', options: ['食慾正常', '精神正常'] },
  { key: 'oral', type: 'finding' },
  { key: 'vet', type: 'text', role: 'vet' },
  { key: 'followUp', type: 'date' },
  { key: 'followUpText', type: 'text', label: '回診日期' },
];
const vaccine = { key: 'p1', values: { reason: '預防針', vaccine: '三合一', signs: ['精神正常', '食慾正常'] } };
const dental = { key: 'p2', values: { reason: '牙齒檢查', teeth: '牙結石二級', oral: '異常' } };

function run(state, preset, previous) {
  const plan = planPresetApplication({
    items,
    preset,
    previous,
    currentValue: (item) => state[item.key],
    baseValue: (item) => (item.defaultValue ?? (item.type === 'checkbox' ? [] : '')),
  });
  for (const { item, value } of plan.changes) state[item.key] = value;
  return plan;
}

describe('planPresetApplication', () => {
  it('第一次套用只覆寫模板有設定的欄位，其餘保留預設值', () => {
    const state = { reason: '例行健檢', vaccine: '', teeth: '醫師自己寫的', signs: [] };
    const plan = run(state, vaccine, null);
    assert.deepEqual(state, { reason: '預防針', vaccine: '三合一', teeth: '醫師自己寫的', signs: ['精神正常', '食慾正常'] });
    assert.deepEqual(Object.keys(plan.applied), ['reason', 'vaccine', 'signs']);
  });

  it('切換模板：沒動過的舊模板欄位退回預設，動過的保留', () => {
    const state = { reason: '例行健檢', vaccine: '', teeth: '', signs: [] };
    const first = run(state, vaccine, null);
    state.signs = ['食慾正常'];
    run(state, dental, { key: 'p1', applied: first.applied });
    assert.deepEqual(state, { reason: '牙齒檢查', vaccine: '', teeth: '牙結石二級', signs: ['食慾正常'] });
  });

  it('獸醫師與日期欄位不在模板範圍內，模板裡就算有值也不套用', () => {
    const state = { reason: '', vet: '李醫師', followUp: '', followUpText: '' };
    const plan = run(state, { key: 'p3', values: { vet: '王醫師', followUp: '2026-10-01', followUpText: '兩週後' } }, null);
    assert.deepEqual(plan.changes, []);
    assert.equal(state.vet, '李醫師');
  });

  it('目前值已經等於模板值就不列入變更；理學檢查等不可預填型別一律忽略', () => {
    const state = { reason: '牙齒檢查', vaccine: '', teeth: '', signs: [] };
    const plan = run(state, dental, null);
    assert.deepEqual(plan.changes.map((change) => change.item.key), ['teeth']);
  });
});

describe('sameValue', () => {
  it('複選不看順序，數字與字串視為相同', () => {
    assert.ok(sameValue(['a', 'b'], ['b', 'a']));
    assert.ok(sameValue(5, '5'));
    assert.ok(!sameValue(['a'], []));
  });
});
