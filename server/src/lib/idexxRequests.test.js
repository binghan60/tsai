import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import IdexxRequest from '../models/IdexxRequest.js';
import Owner from '../models/Owner.js';
import Pet from '../models/Pet.js';
import { decodeIdexxXml } from './idexxResult.js';
import { syncIdexxCensus } from './idexxRequests.js';

const original = { findOne: IdexxRequest.findOne, create: IdexxRequest.create, petFindById: Pet.findById, ownerFindById: Owner.findById };
const pet = { _id: '66f0a1b2c3d4e5f601234567', name: '牛奶', species: '貓', sex: 'male', neutered: 'no', ownerId: 'o1', weightKg: 3.9 };
const census = { mode: 'census', encoding: 'big5' };

function mockModels({ last = null } = {}) {
  const created = [];
  IdexxRequest.findOne = () => ({ sort: () => ({ lean: async () => last }) });
  IdexxRequest.create = async (doc) => { created.push(doc); return doc; };
  Pet.findById = () => ({ lean: async () => pet });
  Owner.findById = () => ({ lean: async () => ({ _id: 'o1', name: '王小明' }) });
  return created;
}

describe('idexxRequests.syncIdexxCensus', () => {
  afterEach(() => {
    Object.assign(IdexxRequest, { findOne: original.findOne, create: original.create });
    Pet.findById = original.petFindById;
    Owner.findById = original.ownerFindById;
  });

  it('伺服器沒開就什麼都不做，連資料庫都不查', async () => {
    IdexxRequest.findOne = () => { throw new Error('不該查'); };
    assert.equal(await syncIdexxCensus({ _id: 'a1', petId: pet._id, status: 'arrived' }, { settings: { mode: 'off', encoding: 'big5' } }), null);
  });

  it('報到：排一份 Big5 的到院通知，檔名＝訊息編號，用這次看診量的體重', async () => {
    const created = mockModels();
    await syncIdexxCensus({ _id: 'a1', petId: pet._id, status: 'arrived', weightKg: 4.2 }, { settings: census });
    assert.equal(created.length, 1);
    const [doc] = created;
    assert.equal(doc.kind, 'in');
    assert.equal(doc.mode, 'census');
    assert.equal(doc.fileName, `${doc.messageId}.xml`);
    // 用系統自己的 IDEXX 解碼器讀回來：照 XML 宣告的 Big5 解得出中文。
    const xml = decodeIdexxXml(doc.body);
    assert.match(xml, /<patient_name>牛奶<\/patient_name>/);
    assert.match(xml, /<last_name>王小明<\/last_name>/);
    assert.match(xml, /<weight>4.2<\/weight>/);
    assert.deepEqual(doc.unmappable, []);
  });

  it('已經送過到院、還在院內：不重複送', async () => {
    const created = mockModels({ last: { kind: 'in', petId: pet._id, mode: 'census', encoding: 'big5' } });
    assert.equal(await syncIdexxCensus({ _id: 'a1', petId: pet._id, status: 'pending_checkout' }, { settings: census }), null);
    assert.equal(created.length, 0);
  });

  it('離開診所：照到院那一份的訊息種類與編碼送離院，中途改了設定也一樣', async () => {
    const created = mockModels({ last: { kind: 'in', petId: pet._id, mode: 'work_request', encoding: 'utf-8' } });
    await syncIdexxCensus({ _id: 'a1', petId: pet._id, status: 'completed' }, { settings: census });
    assert.equal(created[0].kind, 'out');
    assert.equal(created[0].mode, 'work_request');
    assert.match(created[0].body.toString('utf8'), /message_sub_type="Cancel"/);
  });

  it('從來沒報到過的取消：不送離院', async () => {
    const created = mockModels();
    assert.equal(await syncIdexxCensus({ _id: 'a1', petId: pet._id, status: 'cancelled' }, { settings: census }), null);
    assert.equal(created.length, 0);
  });
});
