import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canCancelHospitalization,
  daySections,
  stayDays,
  stayRows,
  emptyEntryDraft,
  entriesOnDate,
  entryDraft,
  entryPatch,
  entryPayload,
  filledFields,
  hasEntryChanges,
  isEmptyEntry,
  newEntryTime,
  stayDayGroups,
  weightTrend,
} from './hospitalization.js';

const entry = (fields = {}) => ({
  _id: 'e1',
  recordedAt: '2026-10-15T06:10:00.000Z', // 台北 14:10
  food: 'a/d 1 罐',
  forceFeeding: '',
  medication: '',
  other: '',
  temperatureC: 38.9,
  __v: 0,
  ...fields,
});

test('表單的值一律是字串，體溫的數字跟畫面上的同一個值不算修改', () => {
  const base = entryDraft(entry());
  assert.equal(base.time, '14:10');
  assert.equal(base.temperatureC, '38.9');
  assert.equal(hasEntryChanges({ ...base, temperatureC: '38.90', food: 'a/d 1 罐 ' }, base), false);
  assert.equal(hasEntryChanges({ ...base, other: '有尿' }, base), true);
});

test('修改只送有變的欄位，時間跟那一天組回時刻', () => {
  const base = entryDraft(entry());
  assert.deepEqual(entryPatch({ ...base, temperatureC: '39' }, base, '2026-10-15'), { temperatureC: '39' });
  assert.deepEqual(entryPatch({ ...base, time: '08:30' }, base, '2026-10-15'), { recordedAt: '2026-10-15T00:30:00.000Z' });
  assert.deepEqual(entryPatch({ ...base, time: '' }, base, '2026-10-15'), {});
});

test('新增整筆送出；只填了時間不算有東西可記', () => {
  const draft = { ...emptyEntryDraft('20:15'), forceFeeding: 'a/d 10 ml' };
  assert.deepEqual(entryPayload(draft, '2026-10-15'), {
    recordedAt: '2026-10-15T12:15:00.000Z', food: '', forceFeeding: 'a/d 10 ml', medication: '', prescription: '', other: '', weightKg: '', temperatureC: '',
  });
  assert.equal(isEmptyEntry(emptyEntryDraft('20:15')), true);
  assert.equal(isEmptyEntry({ ...emptyEntryDraft('20:15'), medication: '**  **' }), true);
  assert.equal(isEmptyEntry({ ...emptyEntryDraft('20:15'), prescription: '[red] [/red]' }), true);
  assert.equal(isEmptyEntry({ ...emptyEntryDraft('20:15'), prescription: 'Azodyl 1 cap PO SID' }), false);
  assert.equal(isEmptyEntry(draft), false);
});

test('時間軸上一筆只列有填的欄位', () => {
  assert.deepEqual(filledFields(entry({ medication: '**Cerenia**' })).map((field) => field.label), ['食物放置', '用藥紀錄', '體溫']);
  assert.deepEqual(filledFields(entry({ medication: 'Cerenia 皮下注射', prescription: '**Azodyl** 1 cap' })).map((field) => [field.label, Boolean(field.rich)]), [['食物放置', false], ['用藥紀錄', true], ['開藥', true], ['體溫', false]]);
  assert.equal(filledFields(entry()).at(-1).value, '38.9 °C');
  assert.deepEqual(filledFields(entry({ food: '', temperatureC: null, forceFeeding: 'a/d 10 ml' })).map((field) => field.key), ['forceFeeding']);
});

test('分天：最新的一天在上面，一天之內照時間先後', () => {
  const list = [
    entry({ _id: 'b', recordedAt: '2026-10-15T03:00:00.000Z' }),
    entry({ _id: 'a', recordedAt: '2026-10-15T00:30:00.000Z' }),
    entry({ _id: 'c', recordedAt: '2026-10-14T15:59:00.000Z' }), // 台北 10/14 23:59
  ];
  assert.deepEqual(entriesOnDate(list, '2026-10-15').map((item) => item._id), ['a', 'b']);
  const sections = daySections(['2026-10-14', '2026-10-15'], list);
  assert.deepEqual(sections.map((day) => [day.date, day.dayNumber, day.entries.length]), [['2026-10-15', 2, 2], ['2026-10-14', 1, 1]]);
});

test('新增時間：今天是現在，過去的日子是那天中午', () => {
  const now = new Date('2026-10-15T06:07:00.000Z');
  assert.equal(newEntryTime('2026-10-15', now), now);
  assert.equal(newEntryTime('2026-10-13', now).toISOString(), '2026-10-13T04:00:00.000Z');
});

test('體重變化：入院那次加上每一格有量的，舊到新，帶跟上一次的差', () => {
  const rows = weightTrend(3.6, [
    { _id: 'c', recordedAt: '2026-10-15T02:00:00.000Z', weightKg: 3.48 },
    { _id: 'a', recordedAt: '2026-10-14T02:00:00.000Z', weightKg: 3.48 },
    { _id: 'x', recordedAt: '2026-10-14T05:00:00.000Z', weightKg: null },
  ]);
  assert.deepEqual(rows.map((row) => [row.label, row.kg, row.delta]), [['入院', 3.6, ''], ['10/14 10:00', 3.48, '−0.12'], ['10/15 10:00', 3.48, '±0']]);
  assert.deepEqual(weightTrend(null, []), []);
});

test('取消住院：從看診搬來的用藥不算紀錄，記了照護紀錄（含體重）就不能取消', () => {
  assert.equal(canCancelHospitalization({ status: 'admitted', entries: [{ fromVisit: true }] }), true);
  assert.equal(canCancelHospitalization({ status: 'admitted', entries: [{ fromVisit: false, weightKg: 3.4 }] }), false);
  assert.equal(canCancelHospitalization({ status: 'discharged', entries: [] }), false);
});

test('住院天數照日曆算，入院那天是第 1 天', () => {
  assert.equal(stayDays('2026-10-13T07:40:00.000Z', '2026-10-18T09:20:00.000Z'), 6);
  assert.equal(stayDays('2026-10-13T15:59:00.000Z', '2026-10-13T16:01:00.000Z'), 2); // 台北 23:59 → 隔天 00:01
});

test('日誌住院摘要一筆一列：同一筆量的體重體溫在同一列，日期只在每天第一列，體重的差第一筆跟入院那次比', () => {
  const rows = stayRows({
    admitWeightKg: 3.6,
    weights: [
      { at: '2026-10-14T02:00:00.000Z', kg: 3.48 },
      { at: '2026-10-14T08:00:00.000Z', kg: 3.5 },
      { at: '2026-10-15T02:00:00.000Z', kg: 3.5 },
    ],
    temperatures: [{ at: '2026-10-14T10:00:00.000Z', c: 39.1 }, { at: '2026-10-14T02:00:00.000Z', c: 38.6 }, { at: '2026-10-16T02:00:00.000Z', c: 38.4 }],
  });
  assert.deepEqual(rows.map((row) => [row.label, row.time, row.kg, row.delta, row.c]), [
    ['10/14', '10:00', 3.48, '−0.12', 38.6],
    ['', '16:00', 3.5, '+0.02', null],
    ['', '18:00', null, '', 39.1],
    ['10/15', '10:00', 3.5, '±0', null],
    ['10/16', '10:00', null, '', 38.4],
  ]);
  assert.deepEqual(rows.map((row) => row.dayStart), [true, false, false, true, true]);
  assert.equal(stayRows({ weights: [{ at: '2026-10-14T02:00:00.000Z', kg: 3.5 }] })[0].delta, '');
  assert.deepEqual(stayRows(null), []);
});

test('日誌住院摘要按天分組：每天先體重體溫、再當天的檢驗；異常項排前面，沒有數值的不列', () => {
  const days = stayDayGroups({
    admitWeightKg: 3.6,
    weights: [{ at: '2026-10-11T02:00:00.000Z', kg: 3.48 }],
    temperatures: [{ at: '2026-10-11T02:00:00.000Z', c: 38.6 }],
    results: [
      { _id: 'late', instrument: 'ProCyte_Dx', runAt: '2026-10-12T02:00:00.000Z', assays: [{ code: 'WBC', value: '11.6', referenceMin: 2.87, referenceMax: 17.02 }] },
      {
        _id: 'chem',
        instrument: 'Catalyst One',
        runAt: '2026-10-10T03:00:00.000Z',
        assays: [
          { code: 'GLU', value: '117', unit: 'mg/dL', referenceMin: 74, referenceMax: 159 },
          { code: 'BUN', value: '41', unit: 'mg/dL', referenceMin: 16, referenceMax: 36 },
          { code: 'CREA', value: '2.9', unit: 'mg/dL', referenceMin: 0.8, referenceMax: 2.4 },
          { code: 'ALT', value: '' },
        ],
        overrides: [{ code: 'CREA', value: '2.2' }],
      },
    ],
  });
  assert.deepEqual(days.map((day) => [day.label, day.vitals.length, day.labs.length]), [['10/10', 0, 1], ['10/11', 1, 0], ['10/12', 0, 1]]);
  const chem = days[0].labs[0];
  assert.equal(chem.time, '11:00');
  assert.equal(chem.abnormalCount, 1, '醫師改過的 CREA 2.2 回到正常範圍，只剩 BUN 異常');
  assert.deepEqual(chem.items.map((item) => [item.code, item.flag]), [['BUN', '↑'], ['GLU', ''], ['CREA', '']]);
  assert.match(chem.items[0].tip, /mg\/dL/);
  assert.match(chem.items[0].tip, /參考範圍 16–36/);
  assert.match(chem.items[2].tip, /IDEXX 原始值 2\.9/);
  assert.deepEqual(stayDayGroups(null), []);
});
