import { after, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import mongoose from 'mongoose';
import { app } from '../app.js';
import Appointment from '../models/Appointment.js';
import ClinicalNote from '../models/ClinicalNote.js';
import { clinicalNoteViews } from '../lib/clinicalNoteView.js';
import MedicalRecord from '../models/MedicalRecord.js';
import FormTemplate from '../models/FormTemplate.js';
import { visitOverlay } from '../lib/recordVisitLink.js';

const id = '507f1f77bcf86cd799439011';
const petId = '507f1f77bcf86cd799439012';
const templateId = '507f1f77bcf86cd799439013';
const chain = value => ({ session: async () => value });
const labTemplate = {
  _id: templateId, version: 1, name: '一般健檢',
  sections: [{ key: 'labs', title: '檢驗', items: [
    { key: 'wbc', label: 'WBC 白血球', type: 'lab', unit: '×10³/µL', referenceMin: 5.5, referenceMax: 19.5 },
    { key: 'alt', label: 'ALT', type: 'lab', unit: 'U/L', referenceMin: 12, referenceMax: 130 },
  ] }],
};

describe('independent appointment workflow HTTP routes', () => {
  let server, origin, store, diary, records, failDiary;
  before(async () => {
    server = app.listen(0, '127.0.0.1');
    if (!server.listening) await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}/api/appointments/${id}/workflow`;
  });
  after(async () => { mock.restoreAll(); await new Promise(resolve => server.close(resolve)); });
  beforeEach(() => {
    mock.restoreAll();
    store = new Map([[id, { _id: id, petId, templateId, __v: 0, date: '2026-09-07', time: '10:00', scheduledAt: new Date('2026-09-07T02:00:00Z'), status: 'arrived', checkinNumber: 1, petName: '豆豆' }]]);
    diary = new Map(); records = new Map(); failDiary = false;
    function document(raw) {
      if (!raw) return null;
      const doc = new Appointment(raw);
      doc.save = async ({ session } = {}) => {
        assert.ok(session, 'writes use the transaction session');
        await doc.validate();
        doc.__v = (doc.__v || 0) + 1;
        store.set(String(doc._id), doc.toObject());
        return doc;
      };
      return doc;
    }
    mock.method(mongoose, 'startSession', async () => {
      const session = {
        withTransaction: async callback => {
          const copyMap = map => new Map([...map].map(([key, value]) => [key, JSON.parse(JSON.stringify(value))]));
          const snapshot = { store: copyMap(store), diary: copyMap(diary), records: copyMap(records) };
          try { return await callback(); }
          catch (err) { ({ store, diary, records } = snapshot); throw err; }
        }, endSession: async () => {},
      };
      return session;
    });
    mock.method(Appointment, 'find', () => ({ lean: async () => [...store.values()] }));
    mock.method(Appointment, 'findById', key => chain(document(store.get(String(key)))));
    mock.method(Appointment, 'create', async ([values], options) => {
      const doc = document({ ...values, _id: new mongoose.Types.ObjectId(), __v: -1 });
      await doc.save(options);
      return [doc];
    });
    mock.method(ClinicalNote, 'findOneAndUpdate', async (query, update, options) => {
      assert.ok(options.session);
      if (failDiary) throw new Error('simulated diary write failure');
      assert.deepEqual(update.$unset, { content: '' });
      assert.equal(update.$set.content, undefined);
      diary.set(String(query.appointmentId), { ...update.$set, appointmentId: query.appointmentId });
    });
    mock.method(ClinicalNote, 'deleteOne', query => ({ session: async session => { assert.ok(session); diary.delete(String(query.appointmentId)); } }));
    mock.method(FormTemplate, 'findOne', () => chain(labTemplate));
    mock.method(FormTemplate, 'findById', () => chain(labTemplate));
    mock.method(MedicalRecord, 'create', async ([values], options) => {
      assert.ok(options.session);
      const record = { ...values, _id: new mongoose.Types.ObjectId(), status: 'draft' };
      records.set(String(record._id), record);
      return [record];
    });
    mock.method(MedicalRecord, 'findById', key => chain(records.get(String(key))));
    mock.method(MedicalRecord, 'updateOne', async (query, update, options) => {
      assert.ok(options.session);
      const record = records.get(String(query._id));
      if (!record || (query.status && record.status !== query.status)) return { modifiedCount: 0 };
      Object.assign(record, update.$set || {});
      record.__v = (record.__v || 0) + (update.$inc?.__v || 0);
      records.set(String(query._id), record);
      return { modifiedCount: 1 };
    });
  });
  async function post(action, values = {}) {
    const response = await fetch(`${origin}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: store.get(id).__v, ...values }) });
    return { status: response.status, body: await response.json() };
  }
  async function diaryContent() { return (await clinicalNoteViews([diary.get(id)]))[0].content; }
  it('saves and updates one diary entry without creating a report', async () => {
    assert.equal((await post('clinical', { visitNote: 'first' })).status, 200);
    assert.equal((await post('clinical', { visitNote: 'second' })).status, 200);
    assert.equal(diary.size, 1);
    assert.equal(await diaryContent(), 'second');
    assert.equal(records.size, 0);
    assert.equal((await post('clinical', { visitNote: '' })).status, 200);
    assert.equal(diary.size, 0);
  });
  it('keeps the visit reason in the same diary through edits and handoff', async () => {
    store.get(id).reason = '咳嗽三天';
    assert.equal((await post('clinical', { visitNote: '安排檢查', internalNote: '院內追蹤', weightKg: 4.2 })).status, 200);
    assert.equal(await diaryContent(), '來院原因：咳嗽三天\n\n體重：4.2 kg\n\n安排檢查');
    assert.equal((await post('clinical', { visitNote: '', internalNote: '', weightKg: null })).status, 200);
    assert.equal(await diaryContent(), '來院原因：咳嗽三天');
    assert.equal((await post('handoff')).status, 200);
    assert.equal(diary.size, 1);
    assert.equal(await diaryContent(), '來院原因：咳嗽三天');
  });
  it('records the reason when handing off without a clinical note', async () => {
    store.get(id).reason = '定期回診';
    assert.equal((await post('handoff')).status, 200);
    assert.equal(await diaryContent(), '來院原因：定期回診');
    assert.equal(records.size, 0);
  });
  it('rolls back the appointment when diary persistence fails', async () => {
    failDiary = true;
    const result = await post('clinical', { visitNote: 'must not partially save' });
    assert.equal(result.status, 500);
    assert.equal(store.get(id).__v, 0);
    assert.equal(store.get(id).visitNote, undefined);
  });
  it('hands the visit to the desk, keeps the queue number, and rejects stale confirmations', async () => {
    await post('clinical', { specialCareNote: '傷口勿舔' });
    const handed = await post('handoff');
    assert.equal(handed.status, 200);
    assert.equal(handed.body.status, 'pending_checkout');
    // 人還在診所等櫃台，號碼牌不歸還；也不會順手建立健檢報告。
    assert.equal(handed.body.checkinNumber, 1);
    assert.equal(records.size, 0);

    const staleVersion = store.get(id).__v - 1;
    assert.equal((await post('complete', { version: staleVersion })).status, 409);

    const done = await post('complete');
    assert.equal(done.status, 200);
    assert.equal(done.body.status, 'completed');
    assert.equal(done.body.checkinNumber, null);
    assert.deepEqual(done.body.checkinNumberHistory, [1]);
  });
  it('lets the vet reclaim a handed-off visit until the desk completes it', async () => {
    await post('handoff');
    assert.equal((await post('clinical', { specialCareNote: '取回前不應修改' })).status, 409);
    const reclaimed = await post('reclaim');
    assert.equal(reclaimed.status, 200);
    assert.equal(reclaimed.body.status, 'arrived');
    assert.equal(reclaimed.body.handoffAt, null);
    // 取回後補內容、再送一次，櫃台完成之後就不能再取回。
    assert.equal((await post('clinical', { followUpRecommendation: '一週後複診' })).status, 200);
    await post('handoff');
    await post('complete');
    assert.equal((await post('reclaim')).status, 409);
    assert.equal((await post('clinical', { visitNote: '事後再改' })).status, 409);
  });
  it('allows the vet to request reopening without a reason', async () => {
    await post('handoff');
    await post('complete');

    const requested = await post('request-reopen');
    assert.equal(requested.status, 200);
    assert.equal(requested.body.reopenRequest.reason, '');
    assert.ok(requested.body.reopenRequest.requestedAt);

    const duplicate = await post('request-reopen', { reason: '不應覆寫原申請' });
    assert.equal(duplicate.status, 409);
    assert.equal(store.get(id).reopenRequest.reason, '');
  });
  it('creates a draft only on demand and reopens the same linked draft', async () => {
    const first = await post('record');
    assert.equal(first.status, 200);
    const second = await post('record');
    assert.equal(second.status, 200);
    assert.equal(second.body.recordId, first.body.recordId);
    assert.equal(records.size, 1);
  });
  it('keeps the follow-up date on the visit only; the linked draft reads it', async () => {
    const created = await post('record');
    assert.equal(created.status, 200);
    const record = records.get(String(created.body.recordId));

    const booked = await post('followup', { followUpDate: '2026-09-14', followUpTime: '10:00' });
    assert.equal(booked.status, 200);
    assert.equal(visitOverlay(record, store.get(id), labTemplate).followUpDate.toISOString(), '2026-09-14T02:00:00.000Z');

    const changed = await post('followup', { followUpDate: '2026-09-15', followUpTime: '14:00' });
    assert.equal(changed.status, 200);
    assert.equal(visitOverlay(record, store.get(id), labTemplate).followUpDate.toISOString(), '2026-09-15T06:00:00.000Z');
    assert.equal(record.followUpDate ?? null, null, '草稿本身不存回診日期');
  });
  it('stores lab values from the booking template, summarises them in the diary and lets the draft reference them', async () => {
    const created = await post('record');
    assert.equal((await post('clinical', { labValues: { lipase: '300' } })).status, 422, '不在範本裡的檢驗項目要擋');
    // 上面那次失敗會把模擬的交易回滾成快照副本，所以之後才取草稿的參照。
    const record = records.get(String(created.body.recordId));
    const versionBefore = record.__v || 0;
    const saved = await post('clinical', { weightKg: '4.2', labValues: { wbc: '22.4', alt: '90' } });
    assert.equal(saved.status, 200);
    assert.deepEqual(store.get(id).labValues.map(lab => [lab.key, lab.value]), [['wbc', '22.4'], ['alt', '90']]);
    assert.match(await diaryContent(), /檢驗：WBC 白血球 22\.4 ×10³\/µL ↑　ALT 90 U\/L/);

    // 草稿不存這幾欄、也不被改寫；讀的時候直接引用看診。
    assert.equal(record.weightKg ?? null, null);
    assert.equal(record.__v || 0, versionBefore);
    const overlay = visitOverlay(record, store.get(id), labTemplate);
    assert.equal(overlay.weightKg, 4.2);
    const wbc = overlay.labFindings.find(finding => finding.key === 'wbc');
    assert.equal(wbc.value, '22.4');
    assert.equal(wbc.status, 'abnormal');
    assert.equal(overlay.labFindings.find(finding => finding.key === 'alt').status, 'normal');

    await post('clinical', { weightKg: '4.5', labValues: { wbc: '25', alt: '140' } });
    const next = visitOverlay(record, store.get(id), labTemplate);
    assert.equal(next.weightKg, 4.5);
    assert.equal(next.labFindings.find(finding => finding.key === 'alt').value, '140');

    // 清空檢驗值＝從看診拿掉。
    await post('clinical', { labValues: { alt: '' } });
    assert.deepEqual(store.get(id).labValues.map(lab => lab.key), ['wbc']);
  });
  it('a draft created after the follow-up is booked still reads it from the visit', async () => {
    const booked = await post('followup', { followUpDate: '2026-09-14', followUpTime: '10:00' });
    assert.equal(booked.status, 200);

    const created = await post('record');
    assert.equal(created.status, 200);
    const record = records.get(String(created.body.recordId));
    assert.equal(record.followUpDate ?? null, null);
    assert.equal(visitOverlay(record, store.get(id), labTemplate).followUpDate.toISOString(), '2026-09-14T02:00:00.000Z');
  });
  it('books one linked follow-up before the desk finishes and validates the clinic schedule', async () => {
    await post('clinical', { followUpRecommendation: '一週後', followUpReason: '追蹤傷口' });
    assert.equal((await post('followup', { followUpDate: '2026-09-14', followUpTime: '12:00' })).status, 422);
    assert.equal((await post('followup', { followUpDate: '2026-02-30', followUpTime: '10:00' })).status, 422);
    const first = await post('followup', { followUpDate: '2026-09-14', followUpTime: '10:00' });
    assert.equal(first.status, 200);
    // 約回診不代表櫃台已經處理完，這筆仍留在待處理匣裡。
    assert.equal(first.body.deskCompletedAt, null);
    const second = await post('followup', { followUpDate: '2026-09-15', followUpTime: '14:00' });
    assert.equal(second.status, 200);
    assert.equal(first.body.followUpAppointmentId, second.body.followUpAppointmentId);
    assert.equal(store.size, 2);
  });
});
