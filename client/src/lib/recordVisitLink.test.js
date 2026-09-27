import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshedVisitKeys, visitEdits, visitSnapshot } from './recordVisitLink.js';

const labKeys = ['wbc', 'alt'];
const server = visitSnapshot({ weightKg: 4.2, temperatureC: 38.6, labFindings: [{ key: 'wbc', value: '22.4' }] }, labKeys);

test('快照是體重、體溫加上表單裡的檢驗項目；數字比數值、不比格式', () => {
  assert.deepEqual(server, { weightKg: '4.2', temperatureC: '38.6', 'lab:wbc': '22.4', 'lab:alt': '' });
  assert.equal(visitSnapshot({ weightKg: '4.20' }).weightKg, '4.2');
  assert.equal(visitSnapshot({ weightKg: null }).weightKg, '');
});

test('只送醫師改過的欄位；清空＝null；檢驗收成 labValues', () => {
  assert.equal(visitEdits(server, server), null);
  const current = { ...server, weightKg: '4.5', temperatureC: '', 'lab:alt': '90' };
  assert.deepEqual(visitEdits(current, server), { weightKg: 4.5, temperatureC: null, labValues: { alt: '90' } });
  // 還沒拿到伺服器的值（新報告）就不送。
  assert.equal(visitEdits(current, null), null);
});

test('存檔回來：存檔期間沒動的欄位換成看診的最新值，正在改的不動', () => {
  const sent = { ...server, weightKg: '4.5' };
  const current = { ...sent, temperatureC: '39' };
  const fromServer = { ...sent, temperatureC: '38.9', 'lab:alt': '140' };
  assert.deepEqual(refreshedVisitKeys({ current, sent, server: fromServer }), ['lab:alt']);
});
