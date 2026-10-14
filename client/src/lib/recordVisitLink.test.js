import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followDeskBooking, refreshedVisitKeys, visitEdits, visitSnapshot } from './recordVisitLink.js';

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

test('櫃台約好、改約、取消回診：報告跟著櫃台的就換，醫師自己填了別天就不動', () => {
  const none = { date: '', time: '' };
  const oct19 = { date: '2026-10-19', time: '14:15' };
  const oct21 = { date: '2026-10-21', time: '15:00' };
  // 報告沒填 → 櫃台約好
  assert.deepEqual(followDeskBooking(none, none, oct19), { form: oct19, notice: 'booked' });
  // 報告跟著櫃台 → 櫃台改約、取消
  assert.deepEqual(followDeskBooking(oct19, oct19, oct21), { form: oct21, notice: 'rescheduled' });
  assert.deepEqual(followDeskBooking(oct19, oct19, none), { form: none, notice: 'cancelled' });
  // 醫師自己填了別天 → 櫃台約好或改約都不蓋掉
  assert.deepEqual(followDeskBooking(oct21, none, oct19), { form: oct21, notice: '' });
  assert.deepEqual(followDeskBooking(oct21, oct19, { date: '2026-10-20', time: '10:00' }), { form: oct21, notice: '' });
  // 櫃台沒變
  assert.deepEqual(followDeskBooking(oct21, oct19, oct19), { form: oct21, notice: '' });
});
