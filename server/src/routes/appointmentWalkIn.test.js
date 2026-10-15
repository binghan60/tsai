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

// 現場加看：沒有掛號、空檔幫忙看的（流浪貓常是這樣），建立時就報到。
const petId = '507f1f77bcf86cd799439051';
const ownerId = '507f1f77bcf86cd799439052';
const clinicOwnerId = '507f1f77bcf86cd799439053';
const templateId = '507f1f77bcf86cd799439054';
const template = { _id: templateId, version: 1, name: '一般門診', enabled: true, sections: [] };

function query(read) {
  const q = {
    select: () => q, populate: () => q, lean: () => q, session: () => q, sort: () => q, limit: () => q,
    then: (resolve, reject) => Promise.resolve().then(read).then(resolve, reject),
  };
  return q;
}

describe('現場加看', () => {
  let server, origin, saved, pets, owners, issued;
  before(async () => {
    server = app.listen(0, '127.0.0.1');
    if (!server.listening) await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}/api`;
  });
  after(async () => { mock.restoreAll(); await new Promise((resolve) => server.close(resolve)); });
  beforeEach(() => {
    mock.restoreAll();
    saved = [];
    pets = [];
    owners = [];
    issued = [];
    mock.method(mongoose, 'startSession', async () => ({ withTransaction: async (callback) => callback({}), endSession: async () => {} }));
    mock.method(FormTemplate, 'findOne', () => query(() => template));
    mock.method(Pet, 'findById', () => query(() => new Pet({ _id: petId, name: '麻糬', species: '貓', ownerId, isStray: false })));
    mock.method(Pet, 'create', async ([data]) => { const doc = new Pet(data); pets.push(doc); return [doc]; });
    mock.method(Owner, 'findById', (id) => query(() => (String(id) === clinicOwnerId ? { name: '院內', phone: '' } : { name: '林小姐', phone: '0900100123' })));
    mock.method(Owner, 'findOne', () => query(() => ({ _id: clinicOwnerId, kind: 'clinic', name: '院內', phone: '' })));
    mock.method(Owner, 'findOneAndUpdate', (filter) => query(() => ({ _id: filter._id, name: '院內', phone: '' })));
    mock.method(Owner, 'create', async ([data]) => { const doc = new Owner(data); owners.push(doc); return [doc]; });
    mock.method(Appointment, 'find', () => query(() => issued));
    mock.method(Appointment, 'exists', () => query(() => null));
    mock.method(Appointment.prototype, 'save', async function save() { saved.push(this); return this; });
    mock.method(MedicalRecord, 'create', async ([data]) => [new MedicalRecord(data)]);
    mock.method(LabResult, 'find', () => query(() => []));
    mock.method(ClinicalNote, 'deleteOne', () => query(() => ({ deletedCount: 0 })));
    mock.method(ClinicalNote, 'findOneAndUpdate', async () => null);
  });

  const post = async (path, body) => {
    const response = await fetch(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };

  it('已建檔的貓：今天、沒有時段、直接報到，配當天沒發過的號碼牌，建報告草稿', async () => {
    issued = [{ checkinNumber: 3, checkinNumberHistory: [1, 2, 3] }];
    const { status, body } = await post('/appointments/walk-in', { petId, reason: '右前腳跛行', templateId });
    assert.equal(status, 201);
    const [appointment] = saved;
    assert.equal(appointment.status, 'arrived');
    assert.equal(appointment.date, clinicToday());
    assert.equal(appointment.time, '');
    assert.ok(appointment.walkInAt);
    assert.equal(appointment.checkedInAt.getTime(), appointment.walkInAt.getTime());
    assert.equal(appointment.latenessMinutes, 0);
    assert.equal(appointment.checkinNumber, 4);
    assert.equal(appointment.ownerName, '林小姐');
    assert.equal(appointment.reason, '右前腳跛行');
    assert.ok(appointment.recordId, '報到時建立健檢報告草稿');
    assert.equal(appointment.depositStatus, '', '不收保證金');
    assert.equal(String(body.appointment._id), String(appointment._id));
  });

  it('櫃台填了手上的號碼牌就用那一張', async () => {
    const { status } = await post('/appointments/walk-in', { petId, templateId, checkinNumber: 12 });
    assert.equal(status, 201);
    assert.equal(saved[0].checkinNumber, 12);
  });

  it('新的流浪貓歸院內：建在院內飼主名下、標成流浪貓，掛號帶流浪貓快照', async () => {
    const { status } = await post('/appointments/walk-in', { strayPet: { name: '小橘', sex: 'male', color: '橘白', bringer: 'clinic' }, templateId });
    assert.equal(status, 201);
    assert.equal(pets.length, 1);
    assert.equal(String(pets[0].ownerId), clinicOwnerId);
    assert.equal(pets[0].isStray, true);
    assert.equal(pets[0].sex, 'male');
    assert.equal(saved[0].isStray, true);
    assert.equal(saved[0].ownerName, '院內');
    assert.equal(owners.length, 0);
  });

  it('新的流浪貓由新的人帶來：一起建飼主（手機整理成純數字）', async () => {
    const { status } = await post('/appointments/walk-in', { strayPet: { name: '阿虎', bringer: 'new', ownerName: '林愛媽', ownerPhone: '0933-222-111' }, templateId });
    assert.equal(status, 201);
    assert.equal(owners[0].phone, '0933222111');
    assert.equal(String(pets[0].ownerId), String(owners[0]._id));
  });

  it('這隻貓今天已經有掛號就擋下，請從那一筆報到', async () => {
    mock.method(Appointment, 'exists', () => query(() => ({ _id: 'booked' })));
    const { status, body } = await post('/appointments/walk-in', { petId, templateId });
    assert.equal(status, 409);
    assert.match(body.message, /從那一筆報到/);
    assert.equal(saved.length, 0);
  });

  it('擋下沒名字、沒選帶貓的人、新的人沒手機', async () => {
    assert.equal((await post('/appointments/walk-in', { strayPet: { bringer: 'clinic' }, templateId })).status, 422);
    assert.equal((await post('/appointments/walk-in', { strayPet: { name: '小橘' }, templateId })).status, 422);
    assert.equal((await post('/appointments/walk-in', { strayPet: { name: '小橘', bringer: 'new', ownerName: '林愛媽' }, templateId })).status, 422);
    assert.equal((await post('/appointments/walk-in', { templateId })).status, 422);
    assert.equal(saved.length, 0);
  });

  it('現場加看不能取消報到或恢復', async () => {
    const walkIn = new Appointment({ _id: '507f1f77bcf86cd799439055', date: clinicToday(), scheduledAt: new Date(), status: 'arrived', walkInAt: new Date(), petId, petName: '麻糬' });
    mock.method(Appointment, 'findById', async () => walkIn);
    const { status, body } = await post(`/appointments/${walkIn._id}/restore`, {});
    assert.equal(status, 422);
    assert.match(body.message, /取消現場/);
    assert.equal(saved.length, 0);
  });
});
