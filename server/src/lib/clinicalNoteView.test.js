import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import Appointment from '../models/Appointment.js';
import ClinicalNote from '../models/ClinicalNote.js';
import Hospitalization from '../models/Hospitalization.js';
import HospitalizationEntry from '../models/HospitalizationEntry.js';
import LabResult from '../models/LabResult.js';
import { clinicalNoteViews } from './clinicalNoteView.js';

// 連到看診的 IDEXX 結果；預設沒有，要測的那一支自己放。
let linkedLabs = [];
mock.method(LabResult, 'find', () => ({ select: () => ({ sort: () => ({ session: () => ({ lean: async () => linkedLabs }) }) }) }));

test('連到看診的 IDEXX 結果列在日誌的「IDEXX 檢驗」，已經在那一段的數值不在「檢驗」重複', async () => {
  const appointment = {
    _id: 'apt', reason: '回診',
    labValues: [{ key: 'crea', label: '肌酸酐', value: '2.9', unit: 'mg/dL', referenceMin: 0.8, referenceMax: 2.4 }, { key: 'wbc', label: '白血球', value: '9', unit: '' }],
  };
  linkedLabs = [{
    appointmentId: 'apt', instrument: 'Catalyst One', runAt: new Date('2026-10-07T06:32:00Z'),
    assays: [{ code: 'CREA', value: '2.9', unit: 'mg/dL', referenceMin: 0.8, referenceMax: 2.4 }, { code: 'BUN', value: '25', unit: 'mg/dL' }, { code: 'ALT', value: '' }],
    filled: [{ key: 'crea', label: '肌酸酐', value: '2.9' }],
    // 醫師在日誌上改過的數值：日誌用改後的值，原始的 assays 不動。
    overrides: [{ code: 'BUN', value: '31' }],
  }];
  const find = mock.method(Appointment, 'find', () => ({ lean: async () => [appointment] }));
  try {
    const [view] = await clinicalNoteViews([{ appointmentId: 'apt' }]);
    const byKey = Object.fromEntries(view.sections.map((section) => [section.key, section.text]));
    assert.equal(byKey.idexx, 'Catalyst One（10/7 14:32）：CREA 2.9 mg/dL ↑　BUN 31 mg/dL');
    assert.equal(view.sections.find((section) => section.key === 'idexx').results[0].assays[1].value, '25');
    assert.equal(byKey.labValues, '白血球 9');
    assert.match(view.content, /IDEXX 檢驗：Catalyst One/);
  } finally {
    find.mock.restore();
    linkedLabs = [];
  }
});

test('linked journals read current appointment fields instead of legacy copied content', async () => {
  const appointment = { _id: 'apt', reason: '回診', visitNote: '最新紀錄' };
  const find = mock.method(Appointment, 'find', () => ({ lean: async () => [appointment] }));
  try {
    const notes = [{ appointmentId: 'apt', content: '過期的副本' }, { content: '手動記事' }];
    assert.equal((await clinicalNoteViews(notes))[0].content, '來院原因：回診\n\n最新紀錄');
    appointment.reason = '追蹤檢查';
    const result = await clinicalNoteViews(notes);
    assert.equal(result[0].content, '來院原因：追蹤檢查\n\n最新紀錄');
    assert.equal(result[0].readOnly, false);
    assert.equal(result[0].editableContent, '最新紀錄');
    assert.deepEqual(result[0].sections.map(section => section.key), ['reason', 'visitNote']);
    assert.equal(result[1].content, '手動記事');
    assert.equal(result[1].sections, undefined);
    assert.equal(notes[0].content, '過期的副本');
  } finally { find.mock.restore(); }
});

test('missing legacy appointment preserves its diary text', async () => {
  const find = mock.method(Appointment, 'find', () => ({ lean: async () => [] }));
  try {
    const [view] = await clinicalNoteViews([{ appointmentId: 'missing', content: '歷史紀錄' }]);
    assert.equal(view.content, '歷史紀錄');
    assert.equal(view.sections, undefined);
  } finally { find.mock.restore(); }
});

test('reference journals allow absent content while manual journals require it', async () => {
  const petId = '507f1f77bcf86cd799439012';
  await new ClinicalNote({ petId, appointmentId: petId, source: 'appointment' }).validate();
  await assert.rejects(new ClinicalNote({ petId }).validate(), /content/);
  const query = ClinicalNote.findOneAndUpdate({}, { $set: { source: 'appointment' }, $unset: { content: '' } });
  assert.equal(ClinicalNote.schema.path('content').isRequired, true);
  assert.equal(ClinicalNote.schema.path('content').options.required.call(query), false);
});

test('入院那次看診的日誌「住院」列：出院後帶住院期間的體重、體溫與檢驗結果，住院中只有期間', async () => {
  const stay = { _id: 'stay', status: 'discharged', admittedAt: new Date('2026-10-13T02:00:00Z'), dischargedAt: new Date('2026-10-18T02:00:00Z') };
  const appointment = { _id: 'apt', reason: '食慾不振', hospitalizationId: 'stay' };
  const find = mock.method(Appointment, 'find', () => ({ lean: async () => [appointment] }));
  const stays = mock.method(Hospitalization, 'find', () => ({ select: () => ({ lean: async () => [stay] }) }));
  const entries = mock.method(HospitalizationEntry, 'find', () => ({ select: () => ({ sort: () => ({ lean: async () => [
    { hospitalizationId: 'stay', recordedAt: new Date('2026-10-14T02:00:00Z'), weightKg: 3.5, temperatureC: 38.6 },
    { hospitalizationId: 'stay', recordedAt: new Date('2026-10-15T02:00:00Z'), weightKg: null, temperatureC: 39.1 },
  ] }) }) }));
  const labs = mock.method(LabResult, 'find', (filter) => (filter.hospitalizationId
    ? { select: () => ({ sort: () => ({ lean: async () => [{ hospitalizationId: 'stay', instrument: 'Catalyst One', runAt: new Date('2026-10-14T03:00:00Z'), assays: [{ code: 'CREA', value: '1.8' }] }] }) }) }
    : { select: () => ({ sort: () => ({ session: () => ({ lean: async () => [] }) }) }) }));
  try {
    const [view] = await clinicalNoteViews([{ appointmentId: 'apt' }]);
    const row = view.sections.find((section) => section.key === 'hospitalization');
    assert.equal(row.hospitalizationId, 'stay');
    assert.deepEqual(row.stay.weights.map((item) => item.kg), [3.5]);
    assert.deepEqual(row.stay.temperatures.map((item) => item.c), [38.6, 39.1]);
    assert.equal(row.stay.results[0].assays[0].value, '1.8');
    assert.doesNotMatch(view.content, /住院/, '純文字版 content 不帶住院摘要');

    stay.status = 'admitted';
    stay.dischargedAt = null;
    const [ongoing] = await clinicalNoteViews([{ appointmentId: 'apt' }]);
    assert.equal(ongoing.sections.find((section) => section.key === 'hospitalization').stay, undefined);
  } finally {
    find.mock.restore(); stays.mock.restore(); entries.mock.restore(); labs.mock.restore();
  }
});
