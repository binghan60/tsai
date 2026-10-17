import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickLatestWeight, recordWeight } from './latestWeight.js';

const visit = (extra) => ({ status: 'completed', date: '2026-10-01', weightKg: 4.2, ...extra });
const record = (extra) => ({ status: 'finalized', supersededBy: null, visitDate: new Date('2026-09-01T00:00:00+08:00'), weightKg: 4, ...extra });

test('挑日期最新的量測，不管是看診還是報告', () => {
  assert.deepEqual(pickLatestWeight({ visits: [visit({ date: '2026-08-01', weightKg: 3.9 })], records: [record()] }), { kg: 4, date: '2026-09-01' });
  assert.deepEqual(pickLatestWeight({ visits: [visit()], records: [record()] }), { kg: 4.2, date: '2026-10-01' });
});

test('同一天看診優先於報告；同一天好幾次看診取比較晚的', () => {
  const sameDay = record({ visitDate: new Date('2026-10-01T00:00:00+08:00'), weightKg: 4.5 });
  assert.equal(pickLatestWeight({ visits: [visit()], records: [sameDay] }).kg, 4.2);
  const morning = visit({ weightKg: 4.1, visitStartedAt: new Date('2026-10-01T10:00:00+08:00') });
  const evening = visit({ weightKg: 4.3, visitStartedAt: new Date('2026-10-01T18:00:00+08:00') });
  assert.equal(pickLatestWeight({ visits: [evening, morning] }).kg, 4.3);
});

test('待報到、取消、未到的看診與被取代、草稿的報告不算', () => {
  for (const status of ['scheduled', 'cancelled', 'no_show']) {
    assert.equal(pickLatestWeight({ visits: [visit({ status })] }), null, status);
  }
  assert.equal(pickLatestWeight({ records: [record({ supersededBy: 'r2' })] }), null);
  assert.equal(pickLatestWeight({ records: [record({ status: 'draft' })] }), null);
});

test('沒填、0 或不是數字的體重不算', () => {
  assert.equal(pickLatestWeight({ visits: [visit({ weightKg: null }), visit({ weightKg: 0 })], records: [record({ weightKg: null })] }), null);
  assert.equal(recordWeight({ sections: [{ items: [{ role: 'weight', value: '' }] }], weightKg: null }), null);
});

test('報告體重先看 role: weight 的項目，沒有才看具名欄位', () => {
  assert.equal(recordWeight({ sections: [{ items: [{ role: 'weight', value: '3.85' }] }], weightKg: null }), 3.85);
  assert.equal(recordWeight({ sections: [{ items: [{ role: 'vet', value: '王醫師' }] }], weightKg: 4.1 }), 4.1);
});

test('都沒有量測時才用貓咪資料手填的值，沒有日期', () => {
  assert.deepEqual(pickLatestWeight({ fallbackKg: 4.6 }), { kg: 4.6, date: '' });
  assert.equal(pickLatestWeight({ visits: [visit()], fallbackKg: 9 }).kg, 4.2);
  assert.equal(pickLatestWeight({ fallbackKg: null }), null);
});

test('住院照護紀錄上的體重也算，同一天住院體重優先於看診，同一天多筆取最後一筆', () => {
  const entries = [
    { recordedAt: '2026-10-02T02:00:00Z', weightKg: 3.5 },
    { recordedAt: '2026-10-02T09:00:00Z', weightKg: 3.42 },
    { recordedAt: '2026-10-01T02:00:00Z', weightKg: 3.6 },
  ];
  assert.deepEqual(pickLatestWeight({ visits: [visit()], entries }), { kg: 3.42, date: '2026-10-02' });
  assert.equal(pickLatestWeight({ visits: [visit({ date: '2026-10-01' })], entries: [{ recordedAt: '2026-10-01T02:00:00Z', weightKg: 3.5 }] }).kg, 3.5);
  assert.equal(pickLatestWeight({ entries: [{ recordedAt: '2026-10-01T02:00:00Z', weightKg: null }], fallbackKg: 4 }).date, '');
});
