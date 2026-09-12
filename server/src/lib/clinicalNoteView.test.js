import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import Appointment from '../models/Appointment.js';
import ClinicalNote from '../models/ClinicalNote.js';
import { clinicalNoteViews } from './clinicalNoteView.js';

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
    assert.equal(result[1].content, '手動記事');
    assert.equal(notes[0].content, '過期的副本');
  } finally { find.mock.restore(); }
});

test('missing legacy appointment preserves its diary text', async () => {
  const find = mock.method(Appointment, 'find', () => ({ lean: async () => [] }));
  try {
    assert.equal((await clinicalNoteViews([{ appointmentId: 'missing', content: '歷史紀錄' }]))[0].content, '歷史紀錄');
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
