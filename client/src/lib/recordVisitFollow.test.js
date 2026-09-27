import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followableKeys, followedValue, nextOverriddenKeys, staleFollowedKeys } from './recordVisitFollow.js';

const keys = followableKeys([{ key: 'wbc' }, { key: 'alt' }]);
const server = { weightKg: 4.2, temperatureC: 38.6, followUp: '2026-10-09 14:30', labFindings: [{ key: 'wbc', value: '22.4' }] };

test('跟隨欄位是體重、體溫、回診日期加上表單裡的檢驗項目', () => {
  assert.deepEqual(keys, ['weightKg', 'temperatureC', 'followUpDate', 'lab:wbc', 'lab:alt']);
});

test('數字比數值、不比格式；空值一律是空字串', () => {
  assert.equal(followedValue({ weightKg: '4.20' }, 'weightKg'), '4.2');
  assert.equal(followedValue({ weightKg: null }, 'weightKg'), '');
  assert.equal(followedValue(server, 'lab:alt'), '');
});

test('醫師改過的跟隨欄位才放進 overriddenKeys；原本覆寫的保留', () => {
  const current = { ...server, weightKg: '4.5', labFindings: [{ key: 'wbc', value: '22.4' }] };
  assert.deepEqual(nextOverriddenKeys({ keys, overridden: ['lab:alt'], current, server }), ['weightKg', 'lab:alt']);
  assert.deepEqual(nextOverriddenKeys({ keys, current: { ...server, weightKg: '4.20' }, server }), [], '同一個數值不同寫法不算改過');
});

test('存檔回來後，沒被覆寫又跟看診不一樣的欄位要換成新值', () => {
  const current = { ...server, weightKg: 4.2, temperatureC: 39 };
  const latest = { ...server, weightKg: 4.4, temperatureC: 38.6 };
  assert.deepEqual(staleFollowedKeys({ keys, overridden: ['temperatureC'], current, server: latest }), ['weightKg']);
});
