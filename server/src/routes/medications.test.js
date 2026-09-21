import { after, before, beforeEach, describe, it, mock } from 'node:test';
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { app } from '../app.js';
import MedicationOrder from '../models/MedicationOrder.js';
import Pet from '../models/Pet.js';
import Appointment from '../models/Appointment.js';
import ClinicalNote from '../models/ClinicalNote.js';

const petId = '507f1f77bcf86cd799439011';
const ownerId = '507f1f77bcf86cd799439012';
describe('領藥 API', () => {
  let server;
  let origin;
  let saved;
  let noteUpserts;
  let noteDeletes;
  const fakeSession = { withTransaction: async () => {}, endSession: async () => {} };
  before(async () => {
    server = app.listen(0, '127.0.0.1');
    if (!server.listening) await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}/api/medications`;
  });
  beforeEach(() => {
    mock.restoreAll(); saved = null; noteUpserts = []; noteDeletes = [];
    // 藥單與日誌同一個 transaction：測試不連真的資料庫，session 換成直接執行 callback 的替身。
    mock.method(mongoose, 'startSession', async () => ({ ...fakeSession, withTransaction: async callback => callback() }));
    mock.method(ClinicalNote, 'findOneAndUpdate', async (filter, update, options) => { noteUpserts.push({ filter, update, options }); return {}; });
    mock.method(ClinicalNote, 'deleteOne', async (filter, options) => { noteDeletes.push({ filter, options }); return { deletedCount: 1 }; });
    mock.method(Pet, 'findById', () => ({ populate: async () => ({ _id: petId, name: '安安', medicalRecordNumber: 'P001', ownerId: { _id: ownerId, name: '陳小姐', phone: '0912345678' } }) }));
    mock.method(MedicationOrder.prototype, 'save', async function () { await this.validate(); saved = this; return this; });
  });
  after(async () => { mock.restoreAll(); await new Promise(resolve => server.close(resolve)); });
  const post = (path, body) => fetch(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('櫃檯可不掛號登記，身份採主檔快照且不接受直接指定待包藥狀態', async () => {
    const response = await post('', { petId, prescription: '原藥單', condition: '近況', status: 'approved', approvedBy: '偽造', petName: '偽造' });
    assert.equal(response.status, 201);
    const data = await response.json();
    assert.equal(data.status, 'review');
    assert.equal(data.petName, '安安');
    assert.equal(data.appointmentId, null);
    assert.equal(data.history[0].action, 'create');
    assert.equal(data.history[0].actor, 'development');
    assert.equal(saved.prescription, '原藥單');
  });
  const reviewOrder = () => {
    const order = new MedicationOrder({ petId, ownerId, petName: '安安', __v: 2, prescription: '原藥單' });
    mock.method(MedicationOrder, 'findById', async () => order);
    return order;
  };
  it('登記藥單（醫師還沒審核）不進病歷：不建立日誌', async () => {
    const response = await post('', { petId, prescription: '原藥單' });
    assert.equal(response.status, 201);
    assert.equal(noteUpserts.length, 0);
  });
  it('醫師審核時才建立獨立的病歷日誌，只存關聯不存內文，且與藥單同一個 transaction', async () => {
    const order = reviewOrder();
    assert.equal((await post(`/${petId}/actions/approve`, { version: 2 })).status, 200);
    assert.equal(noteUpserts.length, 1);
    const [{ filter, update, options }] = noteUpserts;
    assert.equal(String(filter.medicationOrderId), String(order._id));
    assert.equal(update.$set.source, 'medication');
    assert.equal(String(update.$set.petId), petId);
    assert.deepEqual(update.$unset, { content: '' });
    assert.equal(options.upsert, true);
    // session 一定要帶上，日誌寫入才會跟藥單同一個 transaction。
    assert.ok(options.session, '日誌寫入沒帶 session');
  });
  it('審核之後日誌一直在：退回重審不會讓它消失，之後的動作都只是重新同步', async () => {
    reviewOrder();
    assert.equal((await post(`/${petId}/actions/approve`, { version: 2 })).status, 200);
    assert.equal((await post(`/${petId}/actions/return`, { version: 2, reason: '劑量再確認' })).status, 200);
    assert.equal(noteUpserts.length, 2);
    assert.equal(noteDeletes.length, 0);
  });
  it('取消：審核過的藥單刪掉日誌，沒審核過的不會留下任何日誌', async () => {
    const order = reviewOrder();
    assert.equal((await post(`/${petId}/actions/approve`, { version: 2 })).status, 200);
    assert.equal((await post(`/${petId}/actions/cancel`, { version: 2, reason: '取消' })).status, 200);
    assert.equal(noteDeletes.length, 1);
    assert.equal(String(noteDeletes[0].filter.medicationOrderId), String(order._id));
    assert.ok(noteDeletes[0].options.session, '日誌刪除沒帶 session');
    assert.equal(noteUpserts.length, 1);

    noteUpserts = []; noteDeletes = [];
    reviewOrder();
    assert.equal((await post(`/${petId}/actions/cancel`, { version: 2, reason: '不用了' })).status, 200);
    assert.equal(noteUpserts.length, 0);
  });
  it('日誌同步失敗時整個請求失敗（交給 transaction 回滾）', async () => {
    reviewOrder();
    mock.method(ClinicalNote, 'findOneAndUpdate', async () => { throw new Error('note write failed'); });
    assert.equal((await post(`/${petId}/actions/approve`, { version: 2 })).status, 500);
  });
  it('拒絕不存在的病患及不符的就診關聯', async () => {
    mock.method(Appointment, 'findById', async () => ({ petId: ownerId }));
    assert.equal((await post('', { petId, appointmentId: ownerId })).status, 422);
    assert.equal(saved, null);
    mock.method(Pet, 'findById', () => ({ populate: async () => null }));
    assert.equal((await post('', { petId })).status, 404);
  });
  it('預設列表跨天包含所有未完成，已領藥可另查並分頁', async () => {
    let filter;
    let skip;
    mock.method(MedicationOrder, 'find', value => {
      filter = value;
      return { select: () => ({ sort: () => ({ skip: value => { skip = value; return { limit: async () => [] }; } }) }) };
    });
    mock.method(MedicationOrder, 'countDocuments', async () => 30);
    mock.method(MedicationOrder, 'aggregate', async () => [{ _id: 'review', count: 3 }]);
    let response = await fetch(origin);
    assert.equal(response.status, 200);
    assert.deepEqual(filter, { status: { $in: ['review', 'approved', 'ready'] } });
    assert.equal((await response.json()).counts.review, 3);
    response = await fetch(`${origin}?status=collected&page=2&limit=10&q=%28`);
    const data = await response.json();
    assert.equal(filter.status, 'collected');
    assert.ok(filter.$or[0].petName.test('安(安'));
    assert.equal(skip, 10);
    assert.equal(data.totalPages, 3);
  });
  it('醫師修改與確認 同次儲存，包藥人員使用舊版操作回 409 且不儲存', async () => {
    const order = new MedicationOrder({ petId, ownerId, petName: '安安', __v: 2, prescription: '原藥單' });
    mock.method(MedicationOrder, 'findById', async () => order);
    let response = await post(`/${petId}/actions/approve`, { version: 2, prescription: '醫師新版' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'approved');
    saved = null;
    response = await post(`/${petId}/actions/ready`, { version: 1 });
    assert.equal(response.status, 409);
    assert.equal(saved, null);
    assert.equal(order.prescription, '醫師新版');
  });
  it('資料庫同時儲存版本衝突回 409', async () => {
    const order = new MedicationOrder({ petId, ownerId, petName: '安安', __v: 2, prescription: '原藥單' });
    mock.method(MedicationOrder, 'findById', async () => order);
    mock.method(MedicationOrder.prototype, 'save', async () => { throw Object.assign(new Error('concurrent save'), { name: 'VersionError' }); });
    assert.equal((await post(`/${petId}/actions/approve`, { version: 2 })).status, 409);
  });
});
