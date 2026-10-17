import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanEntryFields, cleanWeight, coversTime, hospitalDayNumber, hospitalizationDates, hospitalizationSpanText, shortClinicDate, stayJournalSummary } from './hospitalization.js';

const at = (text) => new Date(`${text}+08:00`);

test('住院第幾天照日曆算：入院那天是第 1 天', () => {
  assert.equal(hospitalDayNumber('2026-10-13', '2026-10-13'), 1);
  assert.equal(hospitalDayNumber('2026-10-13', '2026-10-15'), 3);
  assert.equal(hospitalDayNumber('2026-12-31', '2027-01-01'), 2);
});

test('住院期間的每一天：入院到出院（或今天），跨月也對', () => {
  assert.deepEqual(hospitalizationDates(at('2026-10-30T23:10:00'), at('2026-11-02T08:00:00')), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepEqual(hospitalizationDates(at('2026-10-15T15:40:00'), at('2026-10-15T18:00:00')), ['2026-10-15']);
});

test('日期寫法跟前端一樣：今年「10/13」，其他年份帶年份', () => {
  assert.equal(shortClinicDate('2026-10-03', at('2026-10-15T12:00:00')), '10/3');
  assert.equal(shortClinicDate('2025-11-02', at('2026-10-15T12:00:00')), '2025/11/2');
});

test('病歷日誌的住院列：住院中寫第幾天，出院了寫期間與天數', () => {
  const now = at('2026-10-15T12:00:00');
  assert.equal(hospitalizationSpanText({ status: 'admitted', admittedAt: at('2026-10-13T15:40:00') }, now), '10/13 起住院中　第 3 天');
  assert.equal(hospitalizationSpanText({ status: 'discharged', admittedAt: at('2026-10-13T15:40:00'), dischargedAt: at('2026-10-18T17:20:00') }, now), '10/13–10/18　6 天');
});

test('檢驗時間落在住院期間才算；取消的住院不算', () => {
  const stay = { status: 'discharged', admittedAt: at('2026-10-13T15:40:00'), dischargedAt: at('2026-10-18T17:20:00') };
  assert.equal(coversTime(stay, at('2026-10-13T15:00:00')), false, '入院前');
  assert.equal(coversTime(stay, at('2026-10-14T09:00:00')), true);
  assert.equal(coversTime(stay, at('2026-10-18T18:00:00')), false, '出院後');
  assert.equal(coversTime({ status: 'admitted', admittedAt: at('2026-10-13T15:40:00') }, at('2026-12-01T09:00:00')), true);
  assert.equal(coversTime({ ...stay, status: 'cancelled' }, at('2026-10-14T09:00:00')), false);
});

test('照護紀錄欄位：沒帶的不動、文字去空白、體溫空白是沒量', () => {
  assert.deepEqual(cleanEntryFields({ food: ' a/d 1 罐 ', temperatureC: '' }), { food: 'a/d 1 罐', temperatureC: null });
  assert.deepEqual(cleanEntryFields({}), {});
  assert.equal(cleanEntryFields({ temperatureC: '38.9' }).temperatureC, 38.9);
  assert.equal(cleanEntryFields({ medication: '**Cerenia** 1 mg/kg' }).medication, '**Cerenia** 1 mg/kg');
  assert.equal(cleanEntryFields({ staff: 'nurse' }).staff, '');
  assert.throws(() => cleanEntryFields({ temperatureC: 'abc' }), /體溫/);
  assert.throws(() => cleanEntryFields({ food: 'x'.repeat(201) }), /太長/);
  assert.throws(() => cleanEntryFields({ recordedAt: 'nope' }), /時間/);
});

test('當天體重：空白清掉、要是合理的數字', () => {
  assert.equal(cleanWeight(''), null);
  assert.equal(cleanWeight('3.42'), 3.42);
  assert.throws(() => cleanWeight('0'), /體重/);
});

test('出院後日誌的住院摘要：有量的體重、體溫各自全列，檢驗結果帶過來', () => {
  const entries = [
    { recordedAt: '2026-10-14T02:00:00Z', weightKg: 3.5, temperatureC: 38.6 },
    { recordedAt: '2026-10-14T09:00:00Z', weightKg: null, temperatureC: 39.1 },
    { recordedAt: '2026-10-15T02:00:00Z', weightKg: 3.42, temperatureC: null },
    { recordedAt: '2026-10-15T09:00:00Z', weightKg: null, temperatureC: null },
  ];
  const summary = stayJournalSummary(entries, [{ _id: 'r1', instrument: 'Catalyst One', runAt: '2026-10-14T03:00:00Z', assays: [{ code: 'CREA', value: '1.8' }] }], 3.6);
  assert.equal(summary.admitWeightKg, 3.6);
  assert.deepEqual(summary.weights.map((item) => item.kg), [3.5, 3.42]);
  assert.deepEqual(summary.temperatures.map((item) => item.c), [38.6, 39.1]);
  assert.equal(summary.results[0].assays[0].value, '1.8');
  assert.deepEqual(stayJournalSummary(), { admitWeightKg: null, weights: [], temperatures: [], results: [] });
});
