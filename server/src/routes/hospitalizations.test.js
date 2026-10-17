import { after, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import mongoose from 'mongoose';
import { app } from '../app.js';
import Appointment from '../models/Appointment.js';
import ClinicalNote from '../models/ClinicalNote.js';
import Hospitalization from '../models/Hospitalization.js';
import HospitalizationEntry from '../models/HospitalizationEntry.js';
import LabResult from '../models/LabResult.js';
import MedicationOrder from '../models/MedicationOrder.js';
import Pet from '../models/Pet.js';
import { clinicToday } from '../lib/clinicTime.js';
import { applyWorkflowAction } from '../lib/appointmentWorkflow.js';

// 住院：從看診收住院、取消住院、出院開帶回家的藥、每天體重與照護紀錄。
const petId = '507f1f77bcf86cd799439071';
const ownerId = '507f1f77bcf86cd799439072';
const appointmentId = '507f1f77bcf86cd799439073';
const stayId = '507f1f77bcf86cd799439074';
const entryId = '507f1f77bcf86cd799439075';

function query(read) {
  const q = {
    select: () => q, populate: () => q, lean: () => q, session: () => q, sort: () => q, limit: () => q, skip: () => q,
    then: (resolve, reject) => Promise.resolve().then(read).then(resolve, reject),
  };
  return q;
}

function visit(extra = {}) {
  const doc = new Appointment({
    _id: appointmentId, date: clinicToday(), scheduledAt: new Date(), status: 'arrived', petId, ownerId,
    petName: '小橘', reason: '急性腎損傷', visitStartedAt: new Date(), ...extra,
  });
  doc.save = async () => doc;
  return doc;
}

function stay(extra = {}) {
  const doc = new Hospitalization({ _id: stayId, petId, admittingAppointmentId: appointmentId, admittedAt: new Date(Date.now() - 3600 * 1000), ...extra });
  doc.save = async () => doc;
  return doc;
}

describe('住院', () => {
  let server, origin, created, entries, orders;
  before(async () => {
    server = app.listen(0, '127.0.0.1');
    if (!server.listening) await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}/api`;
  });
  after(async () => { mock.restoreAll(); await new Promise((resolve) => server.close(resolve)); });
  beforeEach(() => {
    mock.restoreAll();
    created = [];
    entries = [];
    orders = [];
    mock.method(mongoose, 'startSession', async () => ({ withTransaction: async (callback) => callback({}), endSession: async () => {} }));
    mock.method(Hospitalization, 'exists', () => query(() => null));
    mock.method(Hospitalization, 'create', async ([data]) => { const doc = new Hospitalization(data); created.push(doc); return [doc]; });
    mock.method(HospitalizationEntry, 'create', async ([data]) => { const doc = new HospitalizationEntry(data); entries.push(doc); return [doc]; });
    mock.method(LabResult, 'find', () => query(() => []));
    mock.method(ClinicalNote, 'findOneAndUpdate', async () => null);
    mock.method(ClinicalNote, 'deleteOne', () => query(() => ({ deletedCount: 0 })));
  });

  const send = async (method, path, body) => {
    const response = await fetch(`${origin}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };

  it('收住院：看診已寫的藥單搬到第一筆照護紀錄的用藥，看診上清空並記下住院單', async () => {
    const appointment = visit({ prescription: '**Cerenia** 1 mg/kg SC' });
    mock.method(Appointment, 'findById', () => query(() => appointment));
    const { status } = await send('POST', '/hospitalizations', { appointmentId, version: 0, reason: '輸液治療', staff: 'vet' });
    assert.equal(status, 201);
    assert.equal(created.length, 1);
    assert.equal(created[0].reason, '輸液治療');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].medication, '**Cerenia** 1 mg/kg SC');
    assert.equal(entries[0].fromVisit, true);
    assert.equal(entries[0].staff, 'vet');
    assert.equal(appointment.prescription, '');
    assert.equal(String(appointment.hospitalizationId), String(created[0]._id));
  });

  it('收住院要先開始看診；櫃台完成處理、已經收過、貓已經在住院都擋', async () => {
    mock.method(Appointment, 'findById', () => query(() => visit({ visitStartedAt: null })));
    assert.equal((await send('POST', '/hospitalizations', { appointmentId, version: 0 })).status, 409);
    mock.method(Appointment, 'findById', () => query(() => visit({ status: 'completed', handoffAt: new Date(), deskCompletedAt: new Date() })));
    assert.equal((await send('POST', '/hospitalizations', { appointmentId, version: 0 })).status, 409);
    mock.method(Appointment, 'findById', () => query(() => visit({ hospitalizationId: stayId })));
    assert.equal((await send('POST', '/hospitalizations', { appointmentId, version: 0 })).status, 409);
    mock.method(Appointment, 'findById', () => query(() => visit()));
    mock.method(Hospitalization, 'exists', () => query(() => ({ _id: 'other' })));
    assert.equal((await send('POST', '/hospitalizations', { appointmentId, version: 0 })).status, 409);
    assert.equal(created.length, 0);
  });

  it('收了住院的看診不能取消看診，也不能再寫藥單', () => {
    assert.throws(() => applyWorkflowAction(visit({ hospitalizationId: stayId }), 'unstart', {}), /取消住院/);
    assert.throws(() => applyWorkflowAction(visit({ hospitalizationId: stayId }), 'clinical', { prescription: 'Cerenia' }), /住院紀錄/);
    const cleared = visit({ hospitalizationId: stayId });
    applyWorkflowAction(cleared, 'clinical', { prescription: '', visitNote: '輸液中' });
    assert.equal(cleared.visitNote, '輸液中');
  });

  it('取消住院：有照護紀錄就擋；只有從看診搬來的用藥時，搬回看診的藥單', async () => {
    const hospitalization = stay();
    mock.method(Hospitalization, 'findById', () => query(() => hospitalization));
    mock.method(HospitalizationEntry, 'find', () => query(() => [{ fromVisit: false, medication: '' }]));
    assert.equal((await send('POST', `/hospitalizations/${stayId}/cancel`, { version: 0 })).status, 409);

    const appointment = visit({ hospitalizationId: stayId, prescription: '' });
    mock.method(HospitalizationEntry, 'find', () => query(() => [{ fromVisit: true, medication: 'Cerenia' }]));
    mock.method(Appointment, 'findById', () => query(() => appointment));
    mock.method(HospitalizationEntry, 'deleteMany', async () => ({ deletedCount: 1 }));
    mock.method(LabResult, 'updateMany', async () => ({ modifiedCount: 0 }));
    const { status } = await send('POST', `/hospitalizations/${stayId}/cancel`, { version: 0 });
    assert.equal(status, 200);
    assert.equal(hospitalization.status, 'cancelled');
    assert.equal(appointment.hospitalizationId, null);
    assert.equal(appointment.prescription, 'Cerenia');
  });

  it('已送交櫃台才收住院、又取消住院：搬回來的藥單重新開成待包藥', async () => {
    const hospitalization = stay();
    mock.method(Hospitalization, 'findById', () => query(() => hospitalization));
    mock.method(HospitalizationEntry, 'find', () => query(() => [{ fromVisit: true, medication: 'Azodyl 1 cap PO SID' }]));
    const appointment = visit({ status: 'pending_checkout', handoffAt: new Date(), hospitalizationId: stayId, prescription: '' });
    mock.method(Appointment, 'findById', () => query(() => appointment));
    mock.method(HospitalizationEntry, 'deleteMany', async () => ({ deletedCount: 1 }));
    mock.method(LabResult, 'updateMany', async () => ({ modifiedCount: 0 }));
    mock.method(MedicationOrder.prototype, 'save', async function save() { orders.push(this); return this; });
    assert.equal((await send('POST', `/hospitalizations/${stayId}/cancel`, { version: 0 })).status, 200);
    assert.equal(orders.length, 1);
    assert.equal(orders[0].status, 'approved');
    assert.equal(orders[0].prescription, 'Azodyl 1 cap PO SID');
    assert.equal(String(appointment.medicationOrderId), String(orders[0]._id));
  });

  it('出院：帶回家的藥開成一張待包藥的藥單（醫師開的，不必再審），連回住院單', async () => {
    const hospitalization = stay();
    mock.method(Hospitalization, 'findById', () => query(() => hospitalization));
    mock.method(Pet, 'findById', () => query(() => ({ _id: petId, name: '小橘', ownerId: { _id: ownerId, name: '院內', phone: '' } })));
    mock.method(MedicationOrder.prototype, 'save', async function save() { orders.push(this); return this; });
    mock.method(ClinicalNote, 'findOneAndUpdate', async () => null);
    const { status } = await send('POST', `/hospitalizations/${stayId}/discharge`, {
      version: 0,
      dischargeNote: '食慾恢復',
      dischargeSpecialCareNote: ' 一週內避免洗澡 ',
      dischargeFollowUpRecommendation: '兩週後回診複查腎指數',
      medication: 'Azodyl 1 cap PO SID',
    });
    assert.equal(status, 200);
    assert.equal(hospitalization.status, 'discharged');
    assert.ok(hospitalization.dischargedAt);
    assert.equal(hospitalization.dischargeNote, '食慾恢復');
    assert.equal(hospitalization.dischargeSpecialCareNote, '一週內避免洗澡');
    assert.equal(hospitalization.dischargeFollowUpRecommendation, '兩週後回診複查腎指數');
    assert.equal(orders.length, 1);
    assert.equal(orders[0].status, 'approved');
    assert.equal(orders[0].fromVisit, false);
    assert.equal(String(orders[0].hospitalizationId), stayId);
    assert.deepEqual(orders[0].history.map((event) => event.action), ['create', 'approve']);
    assert.equal(String(hospitalization.dischargeMedicationOrderId), String(orders[0]._id));
  });

  it('出院沒寫帶回家的藥就不開藥單；已出院的不能再出院', async () => {
    const hospitalization = stay();
    mock.method(Hospitalization, 'findById', () => query(() => hospitalization));
    assert.equal((await send('POST', `/hospitalizations/${stayId}/discharge`, { version: 0 })).status, 200);
    assert.equal(hospitalization.dischargeMedicationOrderId, null);
    assert.equal((await send('POST', `/hospitalizations/${stayId}/discharge`, { version: 0 })).status, 409);
  });

  it('每一格照護紀錄可以有自己的體重，只能記在住院期間的日子', async () => {
    mock.method(Hospitalization, 'findById', () => query(() => stay()));
    const created = [];
    mock.method(HospitalizationEntry, 'create', async (data) => { created.push(data); return data; });
    assert.equal((await send('POST', `/hospitalizations/${stayId}/entries`, { food: '同上', weightKg: '3.42' })).status, 201);
    assert.equal(created[0].weightKg, 3.42);
    assert.equal((await send('POST', `/hospitalizations/${stayId}/entries`, { food: '同上', weightKg: '-1' })).status, 422);
    assert.equal((await send('POST', `/hospitalizations/${stayId}/entries`, { weightKg: '3.42', recordedAt: '2020-01-01T03:00:00Z' })).status, 422);
  });

  it('改照護紀錄要帶版本，別台改過就回 409 附最新內容', async () => {
    mock.method(Hospitalization, 'findById', () => query(() => stay()));
    mock.method(HospitalizationEntry, 'findOneAndUpdate', () => query(() => null));
    mock.method(HospitalizationEntry, 'findOne', () => query(() => ({ _id: entryId, __v: 3, food: 'a/d 1 罐' })));
    const { status, body } = await send('PUT', `/hospitalizations/${stayId}/entries/${entryId}`, { version: 1, food: '同上' });
    assert.equal(status, 409);
    assert.equal(body.current.food, 'a/d 1 罐');
  });
});
