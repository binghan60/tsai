import { after, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import mongoose from 'mongoose';
import { app } from '../app.js';
import Appointment from '../models/Appointment.js';
import ClinicalNote from '../models/ClinicalNote.js';
import MedicalRecord from '../models/MedicalRecord.js';
import FormTemplate from '../models/FormTemplate.js';

const id = '507f1f77bcf86cd799439011';
const petId = '507f1f77bcf86cd799439012';
const templateId = '507f1f77bcf86cd799439013';
const chain = value => ({ session: async () => value });

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
    store = new Map([[id, { _id: id, petId, templateId, __v: 0, date: '2026-09-07', time: '10:00', scheduledAt: new Date('2026-09-07T02:00:00Z'), status: 'arrived', checkinNumber: 1, billingSubtotal: 0, petName: '豆豆' }]]);
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
    mock.method(Appointment, 'findById', key => chain(document(store.get(String(key)))));
    mock.method(Appointment, 'create', async ([values], options) => {
      const doc = document({ ...values, _id: new mongoose.Types.ObjectId(), __v: -1 });
      await doc.save(options);
      return [doc];
    });
    mock.method(ClinicalNote, 'findOneAndUpdate', async (query, update, options) => {
      assert.ok(options.session);
      if (failDiary) throw new Error('simulated diary write failure');
      diary.set(String(query.appointmentId), update.$set);
    });
    mock.method(ClinicalNote, 'deleteOne', query => ({ session: async session => { assert.ok(session); diary.delete(String(query.appointmentId)); } }));
    mock.method(FormTemplate, 'findOne', () => chain({ _id: templateId, version: 1, name: '一般健檢', sections: [] }));
    mock.method(MedicalRecord, 'create', async ([values], options) => {
      assert.ok(options.session);
      const record = { ...values, _id: new mongoose.Types.ObjectId(), status: 'draft' };
      records.set(String(record._id), record);
      return [record];
    });
    mock.method(MedicalRecord, 'findById', key => chain(records.get(String(key))));
  });
  async function post(action, values = {}) {
    const response = await fetch(`${origin}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: store.get(id).__v, ...values }) });
    return { status: response.status, body: await response.json() };
  }
  it('saves and updates one diary entry without creating a report', async () => {
    assert.equal((await post('clinical', { visitNote: 'first' })).status, 200);
    assert.equal((await post('clinical', { visitNote: 'second' })).status, 200);
    assert.equal(diary.size, 1);
    assert.equal(diary.get(id).content, 'second');
    assert.equal(records.size, 0);
    assert.equal((await post('clinical', { visitNote: '' })).status, 200);
    assert.equal(diary.size, 0);
  });
  it('rolls back the appointment when diary persistence fails', async () => {
    failDiary = true;
    const result = await post('clinical', { visitNote: 'must not partially save' });
    assert.equal(result.status, 500);
    assert.equal(store.get(id).__v, 0);
    assert.equal(store.get(id).visitNote, undefined);
  });
  it('can collect payment before finishing the visit and rejects repeat/stale confirmations', async () => {
    await post('clinical', { billingItems: [{ name: '看診費', quantity: 1, unitPrice: 850, amount: 850 }] });
    assert.equal((await post('bill')).status, 200);
    const version = store.get(id).__v;
    const paid = await post('pay', { billingRevision: 1, checkoutTotal: 850, paymentMethod: 'cash' });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.visitCompletedAt, null);
    assert.equal(records.size, 0);
    assert.equal((await post('pay', { version, billingRevision: 1, checkoutTotal: 850, paymentMethod: 'cash' })).status, 409);
    assert.equal((await post('finish')).body.status, 'completed');
    assert.equal(records.size, 0);
  });
  it('creates a draft only on demand and reopens the same linked draft', async () => {
    const first = await post('record');
    assert.equal(first.status, 200);
    const second = await post('record');
    assert.equal(second.status, 200);
    assert.equal(second.body.recordId, first.body.recordId);
    assert.equal(records.size, 1);
  });
  it('books one linked follow-up independently of payment and validates the clinic schedule', async () => {
    await post('clinical', { followUpRecommendation: '一週後', followUpReason: '追蹤傷口' });
    assert.equal((await post('followup', { followUpDate: '2026-09-14', followUpTime: '12:00' })).status, 422);
    assert.equal((await post('followup', { followUpDate: '2026-02-30', followUpTime: '10:00' })).status, 422);
    const first = await post('followup', { followUpDate: '2026-09-14', followUpTime: '10:00' });
    assert.equal(first.status, 200);
    assert.equal(first.body.paymentCompletedAt, null);
    const second = await post('followup', { followUpDate: '2026-09-15', followUpTime: '14:00' });
    assert.equal(second.status, 200);
    assert.equal(first.body.followUpAppointmentId, second.body.followUpAppointmentId);
    assert.equal(store.size, 2);
  });
});
