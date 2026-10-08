import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import IdexxRequest from '../models/IdexxRequest.js';
import LabResult from '../models/LabResult.js';
import Owner from '../models/Owner.js';
import Pet from '../models/Pet.js';
import { decodeIdexxXml } from './idexxResult.js';
import Appointment from '../models/Appointment.js';
import { markIdexxRequestDelivered, syncIdexxCensus } from './idexxRequests.js';

const original = {
  findOne: IdexxRequest.findOne, create: IdexxRequest.create, petFindById: Pet.findById, ownerFindById: Owner.findById, labExists: LabResult.exists,
};
const pet = { _id: '66f0a1b2c3d4e5f601234567', name: '牛奶', species: '貓', sex: 'male', neutered: 'no', ownerId: 'o1', weightKg: 3.9 };
const census = { mode: 'census', encoding: 'big5' };
const requested = new Date('2026-10-06T06:00:00Z');

function mockModels({ last = null, hasResult = false } = {}) {
  const created = [];
  IdexxRequest.findOne = () => ({ sort: () => ({ lean: async () => last }) });
  IdexxRequest.create = async (doc) => { created.push(doc); return doc; };
  Pet.findById = () => ({ lean: async () => pet });
  Owner.findById = () => ({ lean: async () => ({ _id: 'o1', name: '王小明' }) });
  LabResult.exists = async () => (hasResult ? { _id: 'lab-1' } : null);
  return created;
}

describe('idexxRequests.syncIdexxCensus', () => {
  afterEach(() => {
    Object.assign(IdexxRequest, { findOne: original.findOne, create: original.create });
    Pet.findById = original.petFindById;
    Owner.findById = original.ownerFindById;
    LabResult.exists = original.labExists;
  });

  it('伺服器沒開就什麼都不做，連資料庫都不查', async () => {
    IdexxRequest.findOne = () => { throw new Error('不該查'); };
    const appointment = { _id: 'a1', petId: pet._id, status: 'arrived', labRequestedAt: requested };
    assert.equal(await syncIdexxCensus(appointment, { settings: { mode: 'off', encoding: 'big5' } }), null);
  });

  it('只是報到、沒按送 IDEXX：不送', async () => {
    const created = mockModels();
    assert.equal(await syncIdexxCensus({ _id: 'a1', petId: pet._id, status: 'arrived', labRequestedAt: null }, { settings: census }), null);
    assert.equal(created.length, 0);
  });

  it('按了送 IDEXX：排一份 Big5 的到院通知，檔名＝訊息編號，用這次看診量的體重', async () => {
    const created = mockModels();
    await syncIdexxCensus({ _id: 'a1', petId: pet._id, status: 'arrived', weightKg: 4.2, labRequestedAt: requested }, { settings: census });
    assert.equal(created.length, 1);
    const [doc] = created;
    assert.equal(doc.kind, 'in');
    assert.equal(doc.mode, 'census');
    assert.equal(doc.fileName, `${doc.messageId}.xml`);
    // 用系統自己的 IDEXX 解碼器讀回來：照 XML 宣告的 Big5 解得出中文。
    const xml = decodeIdexxXml(doc.body);
    assert.match(xml, /<patient_name>牛奶<\/patient_name>/);
    assert.match(xml, /<first_name>小明<\/first_name>\s*<last_name>王<\/last_name>/);
    assert.match(xml, /<weight>4.2<\/weight>/);
    assert.deepEqual(doc.unmappable, []);
  });

  it('已經送過、還在院內：不重複送', async () => {
    const created = mockModels({ last: { kind: 'in', petId: pet._id, mode: 'census', encoding: 'big5' } });
    const appointment = { _id: 'a1', petId: pet._id, status: 'pending_checkout', labRequestedAt: requested };
    assert.equal(await syncIdexxCensus(appointment, { settings: census }), null);
    assert.equal(created.length, 0);
  });

  it('取消送 IDEXX（人還在院內）：送離院', async () => {
    const created = mockModels({ last: { kind: 'in', petId: pet._id, mode: 'census', encoding: 'big5' } });
    await syncIdexxCensus({ _id: 'a1', petId: pet._id, status: 'arrived', labRequestedAt: null }, { settings: census });
    assert.equal(created[0].kind, 'out');
    assert.match(decodeIdexxXml(created[0].body), /message_sub_type="out"/);
  });

  it('離開診所：照送出那一份的訊息種類與編碼收掉，中途改了設定也一樣', async () => {
    const created = mockModels({ last: { kind: 'in', petId: pet._id, mode: 'work_request', encoding: 'utf-8' } });
    await syncIdexxCensus({ _id: 'a1', petId: pet._id, status: 'completed', labRequestedAt: requested }, { settings: census });
    assert.equal(created[0].kind, 'out');
    assert.equal(created[0].mode, 'work_request');
    assert.match(created[0].body.toString('utf8'), /message_sub_type="Cancel"/);
  });

  it('開單的檢驗已經做完（結果回來了）：不送取消，只記一筆已收掉', async () => {
    const created = mockModels({ last: { kind: 'in', petId: pet._id, mode: 'work_request', encoding: 'big5' }, hasResult: true });
    await syncIdexxCensus({ _id: 'a1', petId: pet._id, status: 'completed', labRequestedAt: requested }, { settings: census });
    assert.equal(created.length, 1);
    assert.equal(created[0].status, 'skipped');
    assert.equal(created[0].kind, 'out');
    assert.equal(created[0].body, undefined);
  });

  it('報到通知（census）就算結果回來了，離院照送', async () => {
    const created = mockModels({ last: { kind: 'in', petId: pet._id, mode: 'census', encoding: 'big5' }, hasResult: true });
    await syncIdexxCensus({ _id: 'a1', petId: pet._id, status: 'completed', labRequestedAt: requested }, { settings: census });
    assert.equal(created[0].status, undefined);
    assert.match(decodeIdexxXml(created[0].body), /message_sub_type="out"/);
  });

  it('從來沒送過檢驗的取消：不送離院', async () => {
    const created = mockModels();
    assert.equal(await syncIdexxCensus({ _id: 'a1', petId: pet._id, status: 'cancelled' }, { settings: census }), null);
    assert.equal(created.length, 0);
  });
});

describe('idexxRequests.markIdexxRequestDelivered', () => {
  const saved = { updateOne: IdexxRequest.updateOne, findById: IdexxRequest.findById, update: Appointment.findByIdAndUpdate };
  afterEach(() => {
    Object.assign(IdexxRequest, { updateOne: saved.updateOne, findById: saved.findById });
    Appointment.findByIdAndUpdate = saved.update;
  });
  const now = new Date('2026-10-06T06:00:10Z');

  function mockDelivery({ modifiedCount = 1, kind = 'in' } = {}) {
    const updates = [];
    IdexxRequest.updateOne = async () => ({ modifiedCount });
    IdexxRequest.findById = () => ({ select: () => ({ lean: async () => ({ appointmentId: 'a1', kind }) }) });
    Appointment.findByIdAndUpdate = async (id, update) => { updates.push({ id, update }); return null; };
    return updates;
  }

  it('到院那一份寫進主機：把送到的時間記在掛號上', async () => {
    const updates = mockDelivery();
    assert.equal(await markIdexxRequestDelivered('r1', 'CLINIC-PC', now), true);
    assert.deepEqual(updates, [{ id: 'a1', update: { $set: { labDeliveredAt: now } } }]);
  });

  it('離院那一份、或已經回報過的：不動掛號', async () => {
    const out = mockDelivery({ kind: 'out' });
    assert.equal(await markIdexxRequestDelivered('r1', 'CLINIC-PC', now), true);
    assert.equal(out.length, 0);
    const repeated = mockDelivery({ modifiedCount: 0 });
    assert.equal(await markIdexxRequestDelivered('r1', 'CLINIC-PC', now), false);
    assert.equal(repeated.length, 0);
  });
});
