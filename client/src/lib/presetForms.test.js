import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPresetFormId, presetFormGroups } from './presetForms.js';

const forms = [
  { _id: 'a', name: '一般健檢', presets: [] },
  { _id: 'b', name: '老貓健檢', presets: [{ key: 'p1', name: '牙齒' }] },
  { _id: 'c', name: '術前評估', presets: [{ key: 'p2', name: '結紮術前' }] },
  { _id: 'd', name: '舊版健檢', enabled: false, presets: [{ key: 'p3', name: '預防針' }] },
];
const ids = (list) => list.map((form) => form._id);

describe('presetFormGroups', () => {
  it('有模板的排前面、同組內維持原順序，已停用另外一組', () => {
    const { active, disabled } = presetFormGroups(forms);
    assert.deepEqual(ids(active), ['b', 'c', 'a']);
    assert.deepEqual(ids(disabled), ['d']);
  });

  it('搜尋同時比對表單名稱與模板名稱，不分大小寫', () => {
    assert.deepEqual(ids(presetFormGroups(forms, '牙齒').active), ['b']);
    assert.deepEqual(ids(presetFormGroups(forms, '術前').active), ['c']);
    assert.deepEqual(ids(presetFormGroups(forms, '預防').disabled), ['d']);
    assert.deepEqual(ids(presetFormGroups([{ _id: 'x', name: 'CKD 追蹤', presets: [] }], 'ckd').active), ['x']);
  });
});

describe('defaultPresetFormId', () => {
  it('網址指定的表單還在就用它', () => {
    assert.equal(defaultPresetFormId(forms, 'a'), 'a');
    assert.equal(defaultPresetFormId(forms, 'd'), 'd');
  });

  it('沒指定或已不存在時，選第一份有模板的啟用中表單', () => {
    assert.equal(defaultPresetFormId(forms), 'b');
    assert.equal(defaultPresetFormId(forms, 'gone'), 'b');
    assert.equal(defaultPresetFormId([]), '');
  });
});
