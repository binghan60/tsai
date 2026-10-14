import { after, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import mongoose from 'mongoose';
import { app } from '../app.js';
import Appointment from '../models/Appointment.js';
import ClinicalNote from '../models/ClinicalNote.js';
import FormTemplate from '../models/FormTemplate.js';
import LabResult from '../models/LabResult.js';
import MedicalRecord from '../models/MedicalRecord.js';
import Owner from '../models/Owner.js';
import Pet from '../models/Pet.js';
import { clinicToday } from '../lib/clinicTime.js';

// 健檢報告一律從看診建立：「新增健檢」列這隻貓的看診、補登一筆過去的看診，以及不再建立獨立報告。
const petId = '507f1f77bcf86cd799439031';
const ownerId = '507f1f77bcf86cd799439032';
const templateId = '507f1f77bcf86cd799439033';
const template = { _id: templateId, version: 2, name: '例行健檢', enabled: true, sections: [] };

function query(read) {
  const q = {
    select: () => q, populate: () => q, lean: () => q, session: () => q, sort: () => q, limit: () => q,
    then: (resolve, reject) => Promise.resolve().then(read).then(resolve, reject),
  };
  return q;
}

describe('健檢報告從看診建立', () => {
  let server, origin, created, notes;
  before(async () => {
    server = app.listen(0, '127.0.0.1');
    if (!server.listening) await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}/api`;
  });
  after(async () => { mock.restoreAll(); await new Promise((resolve) => server.close(resolve)); });
  beforeEach(() => {
    mock.restoreAll();
    created = { appointments: [], records: [] };
    notes = [];
    mock.method(mongoose, 'startSession', async () => ({ withTransaction: async (callback) => callback({}), endSession: async () => {} }));
    mock.method(FormTemplate, 'findOne', () => query(() => template));
    mock.method(Pet, 'findById', () => query(() => ({ _id: petId, name: '麻糬', species: '貓', ownerId: { _id: ownerId, name: '林小姐', phone: '0900100123' } })));
    mock.method(Appointment, 'create', async ([data]) => {
      const doc = new Appointment(data);
      doc.save = async () => doc;
      created.appointments.push(doc);
      return [doc];
    });
    mock.method(MedicalRecord, 'create', async ([data]) => {
      const doc = new MedicalRecord(data);
      created.records.push(doc);
      return [doc];
    });
    mock.method(MedicalRecord, 'findById', (key) => query(() => created.records.find((record) => String(record._id) === String(key)) ?? null));
    mock.method(LabResult, 'find', () => query(() => []));
    // 補登完會補套用等著的 IDEXX 結果（找飼主手機認貓）；這裡沒有等著的。
    mock.method(Owner, 'findOne', () => query(() => null));
    mock.method(ClinicalNote, 'findOneAndUpdate', async (filter, update) => { notes.push({ filter, update }); });
  });

  const post = async (path, body) => {
    const response = await fetch(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };

  it('不再建立沒有對應看診的獨立報告', async () => {
    const { status, body } = await post(`/pets/${petId}/records`, { templateId });
    assert.equal(status, 422);
    assert.match(body.message, /從看診建立/);
  });

  it('補登看診：一筆已完成的看診＋報告草稿＋病歷日誌，三個里程碑都是看診當時', async () => {
    const { status, body } = await post('/appointments/backfill', { petId, date: '2026-10-05', time: '14:30', reason: '皮膚複診', templateId });
    assert.equal(status, 201);
    const [appointment] = created.appointments;
    assert.equal(appointment.status, 'completed');
    assert.equal(appointment.date, '2026-10-05');
    assert.equal(appointment.petName, '麻糬');
    assert.equal(appointment.ownerName, '林小姐');
    const at = appointment.scheduledAt.getTime();
    for (const key of ['checkedInAt', 'visitStartedAt', 'handoffAt', 'deskCompletedAt']) assert.equal(appointment[key].getTime(), at, key);
    assert.ok(appointment.backfilledAt);
    assert.equal(appointment.checkinNumber ?? null, null, '補登的看診沒有號碼牌');
    assert.equal(String(appointment.recordId), String(created.records[0]._id));
    assert.equal(created.records[0].chiefComplaint, '皮膚複診');
    assert.equal(String(body.record._id), String(created.records[0]._id));
    assert.equal(notes.length, 1, '補登的看診有病歷日誌');
  });

  it('補登只能補今天以前，日期要有效', async () => {
    const tomorrow = new Date(`${clinicToday()}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    assert.equal((await post('/appointments/backfill', { petId, date: tomorrow.toISOString().slice(0, 10), templateId })).status, 422);
    assert.equal((await post('/appointments/backfill', { petId, date: '2026-13-40', templateId })).status, 422);
    assert.equal((await post('/appointments/backfill', { petId: 'x', date: '2026-10-05', templateId })).status, 422);
    assert.equal(created.appointments.length, 0);
  });

  it('列這隻貓有看診的掛號，帶著報告（修訂過的指向最新一版）', async () => {
    const rootId = '507f1f77bcf86cd799439041';
    const latestId = '507f1f77bcf86cd799439042';
    mock.method(Appointment, 'find', (filter) => {
      assert.equal(String(filter.petId), petId);
      assert.deepEqual(filter.status.$in, ['arrived', 'pending_checkout', 'completed']);
      return query(() => [
        { _id: 'a1', date: '2026-10-12', status: 'completed', recordId: rootId },
        { _id: 'a2', date: '2026-09-28', status: 'completed', recordId: null },
      ]);
    });
    mock.method(MedicalRecord, 'find', () => query(() => [{ _id: latestId, status: 'finalized', revisionRootId: rootId }]));
    const response = await fetch(`${origin}/appointments/visits?petId=${petId}`);
    const { items } = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(items.map((item) => item.report && [String(item.report._id), item.report.status]), [[latestId, 'finalized'], null]);
  });
});
