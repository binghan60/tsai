import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { app } from '../app.js';
import LabResult from '../models/LabResult.js';
import LabBridgeStatus from '../models/LabBridgeStatus.js';
import Pet from '../models/Pet.js';
import Appointment from '../models/Appointment.js';
import { labResultContent } from '../lib/labResultImport.js';
import { parseIdexxResult } from '../lib/idexxResult.js';

const token = 't'.repeat(40);
const catalyst = readFileSync(new URL('../../test/fixtures/idexx/catalyst-one.xml', import.meta.url));

describe('lab results routes', () => {
  let server;
  let origin;
  const original = {
    token: process.env.IDEXX_BRIDGE_TOKEN,
    findOne: LabResult.findOne,
    create: LabResult.create,
    updateOne: LabResult.updateOne,
    find: LabResult.find,
    countDocuments: LabResult.countDocuments,
    statusUpdateOne: LabBridgeStatus.updateOne,
    statusFind: LabBridgeStatus.find,
    findOneAndUpdate: LabResult.findOneAndUpdate,
    findById: LabResult.findById,
    petExists: Pet.exists,
    appointmentFind: Appointment.find,
  };

  before(async () => {
    server = app.listen(0, '127.0.0.1');
    if (!server.listening) await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(() => {
    process.env.IDEXX_BRIDGE_TOKEN = token;
    Object.assign(LabResult, {
      findOne: original.findOne,
      create: original.create,
      updateOne: original.updateOne,
      find: original.find,
      countDocuments: original.countDocuments,
    });
    Object.assign(LabBridgeStatus, { updateOne: original.statusUpdateOne, find: original.statusFind });
    Object.assign(LabResult, { findOneAndUpdate: original.findOneAndUpdate, findById: original.findById });
    Pet.exists = original.petExists;
    Appointment.find = original.appointmentFind;
  });

  after(async () => {
    if (original.token === undefined) delete process.env.IDEXX_BRIDGE_TOKEN;
    else process.env.IDEXX_BRIDGE_TOKEN = original.token;
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  function upload(body, { auth = `Bearer ${token}`, fileName = encodeURIComponent('OO_娜娜_Catalyst_One.xml') } = {}) {
    const headers = { 'content-type': 'application/xml', 'x-file-name': fileName };
    if (auth) headers.authorization = auth;
    return fetch(`${origin}/api/lab-results/import`, { method: 'POST', headers, body });
  }

  function mockExisting(doc) {
    LabResult.findOne = () => ({ lean: async () => doc });
  }

  it('伺服器沒設定密鑰時整個關閉', async () => {
    delete process.env.IDEXX_BRIDGE_TOKEN;
    const response = await upload(catalyst);
    assert.equal(response.status, 503);
  });

  it('密鑰不對就擋，不走網頁登入', async () => {
    process.env.IDEXX_BRIDGE_TOKEN = token;
    assert.equal((await upload(catalyst, { auth: null })).status, 401);
    assert.equal((await upload(catalyst, { auth: `Bearer ${'x'.repeat(40)}` })).status, 401);
  });

  it('第一次收到：存下解析結果、原始檔與中文檔名', async () => {
    process.env.IDEXX_BRIDGE_TOKEN = token;
    let saved;
    mockExisting(null);
    LabResult.create = async (doc) => { saved = doc; return { _id: 'lab-1' }; };
    const response = await upload(catalyst);
    assert.equal(response.status, 201);
    // 範例裡的病患編號是 000001（不是我們的貓咪編號），認不出是哪隻貓，不碰看診。
    assert.deepEqual(await response.json(), { status: 'created', id: 'lab-1', fill: { status: 'unmatched' } });
    assert.equal(saved.instrument, 'Catalyst_One');
    assert.equal(saved.patient.name, '娜娜');
    assert.equal(saved.assays.length, 4);
    assert.equal(saved.fileName, 'OO_娜娜_Catalyst_One.xml');
    assert.match(saved.rawXml, /<patient_name>娜娜<\/patient_name>/);
  });

  it('同一份再送一次只記收到次數，不覆寫內容與配對', async () => {
    process.env.IDEXX_BRIDGE_TOKEN = token;
    let update;
    mockExisting({ _id: 'lab-1', petId: null, ...labResultContent(parseIdexxResult(catalyst)) });
    LabResult.updateOne = async (_filter, value) => { update = value; };
    const response = await upload(catalyst);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'duplicate');
    assert.deepEqual(Object.keys(update.$set), ['lastReceivedAt']);
    assert.deepEqual(update.$inc, { receiveCount: 1 });
  });

  it('內容不同的更正版：覆寫內容、記下更正時間，配對欄位不動', async () => {
    process.env.IDEXX_BRIDGE_TOKEN = token;
    let update;
    const old = labResultContent(parseIdexxResult(catalyst));
    mockExisting({ _id: 'lab-1', petId: null, ...old, messageAt: new Date('2000-01-01'), assays: old.assays.slice(0, 1) });
    LabResult.updateOne = async (_filter, value) => { update = value; };
    const response = await upload(catalyst);
    assert.equal((await response.json()).status, 'updated');
    assert.equal(update.$set.assays.length, 4);
    assert.ok(update.$set.revisedAt instanceof Date);
    assert.equal('petId' in update.$set, false);
  });

  it('IDEXX 帶回我們的貓咪編號：自動認貓，再找當天的看診（這裡當天沒掛號）', async () => {
    process.env.IDEXX_BRIDGE_TOKEN = token;
    const petId = '64b000000000000000000001';
    const withPetId = catalyst.toString('utf8').replace('patient_id="000001"', `patient_id="${petId}"`);
    let matched;
    let visitQuery;
    mockExisting(null);
    LabResult.create = async () => ({ _id: 'lab-1' });
    Pet.exists = async () => ({ _id: petId });
    LabResult.findOneAndUpdate = async (filter, update) => { matched = { filter, update }; return { petId }; };
    LabResult.findById = () => ({ lean: async () => ({ _id: 'lab-1', petId, appliedAt: null, runAt: new Date('2011-09-09T02:36:47.880Z'), assays: [] }) });
    Appointment.find = (filter) => { visitQuery = filter; return { select: () => ({ lean: async () => [] }) }; };

    const response = await upload(withPetId);
    assert.equal(response.status, 201);
    assert.deepEqual(matched.filter, { _id: 'lab-1', petId: null });
    assert.equal(matched.update.$set.matchSource, 'patient_id');
    // 當天＝檢驗時間換算成台北的日期。
    assert.deepEqual(visitQuery, { petId, date: '2011-09-09' });
    assert.deepEqual((await response.json()).fill, { status: 'no_visit', date: '2011-09-09' });
  });

  it('不是檢驗結果的訊息收下不處理，讓抓檔程式歸檔', async () => {
    process.env.IDEXX_BRIDGE_TOKEN = token;
    const response = await upload('<?xml version="1.0"?><message message_type="Work_Request" message_sub_type="Complete"/>');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'ignored');
  });

  it('寫到一半的檔案回 422，抓檔程式之後再試', async () => {
    process.env.IDEXX_BRIDGE_TOKEN = token;
    const response = await upload(catalyst.subarray(0, 500));
    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, 'malformed');
  });

  function heartbeat(body, auth = `Bearer ${token}`) {
    const headers = { 'content-type': 'application/json' };
    if (auth) headers.authorization = auth;
    return fetch(`${origin}/api/lab-results/heartbeat`, { method: 'POST', headers, body: JSON.stringify(body) });
  }

  it('心跳：每台一筆 upsert，時間用伺服器收到的時刻', async () => {
    process.env.IDEXX_BRIDGE_TOKEN = token;
    let call;
    LabBridgeStatus.updateOne = async (filter, update, options) => { call = { filter, update, options }; };
    const before = Date.now();
    const response = await heartbeat({
      bridgeId: 'FRONT-DESK',
      hostname: 'FRONT-DESK',
      version: '1.0.0',
      pendingFiles: 2,
      lastUploadAt: '2026-09-30T02:00:00.000Z',
      lastError: '',
    });
    assert.equal(response.status, 200);
    assert.deepEqual(call.filter, { bridgeId: 'FRONT-DESK' });
    assert.equal(call.options.upsert, true);
    assert.equal(call.update.$set.pendingFiles, 2);
    assert.equal(call.update.$set.lastUploadAt.toISOString(), '2026-09-30T02:00:00.000Z');
    assert.ok(call.update.$set.lastSeenAt.getTime() >= before);
  });

  it('心跳：沒帶密鑰或沒有 bridgeId 都擋', async () => {
    process.env.IDEXX_BRIDGE_TOKEN = token;
    LabBridgeStatus.updateOne = async () => assert.fail('不該寫入');
    assert.equal((await heartbeat({ bridgeId: 'x' }, null)).status, 401);
    assert.equal((await heartbeat({ hostname: 'x' })).status, 422);
  });

  it('查詢抓檔程式狀態：超過三分鐘沒心跳就是離線', async () => {
    const now = Date.now();
    LabBridgeStatus.find = () => ({
      sort: () => ({
        lean: async () => [
          { bridgeId: 'A', lastSeenAt: new Date(now - 60_000) },
          { bridgeId: 'B', lastSeenAt: new Date(now - 10 * 60_000) },
        ],
      }),
    });
    const response = await fetch(`${origin}/api/lab-results/bridge-status`);
    assert.equal(response.status, 200);
    const { items } = await response.json();
    assert.deepEqual(items.map(({ bridgeId, online }) => [bridgeId, online]), [['A', true], ['B', false]]);
  });

  it('數值差異清單：報告上已經改成一樣的不列，順手關掉那筆', async () => {
    const appointmentId = '64b0000000000000000000a1';
    let queried;
    let closed;
    const originalUpdateMany = LabResult.updateMany;
    LabResult.find = (filter) => {
      queried = filter;
      return { sort: () => ({ select: () => ({ lean: async () => [
        { _id: 'r1', instrument: 'Catalyst_One', appointmentId, conflicts: [{ key: 'cre', label: 'CRE', idexx: '1.7' }] },
        { _id: 'r2', instrument: 'SNAP', appointmentId, conflicts: [{ key: 'felv', label: 'FeLV', idexx: 'Negative' }] },
      ] }) }) };
    };
    Appointment.find = () => ({ select: () => ({ lean: async () => [
      { _id: appointmentId, petName: '牛奶', date: '2026-10-04', labValues: [{ key: 'cre', value: '1.5' }, { key: 'felv', value: 'Negative' }] },
    ] }) });
    LabResult.updateMany = async (filter) => { closed = filter; };
    try {
      const { items } = await (await fetch(`${origin}/api/lab-results/conflicts?appointmentId=${appointmentId}`)).json();
      assert.deepEqual(queried, { conflictsOpen: true, appointmentId });
      assert.equal(items.length, 1);
      assert.deepEqual(items[0].items, [{ key: 'cre', label: 'CRE', current: '1.5', idexx: '1.7' }]);
      assert.equal(items[0].petName, '牛奶');
      assert.deepEqual(closed._id, { $in: ['r2'] });
      assert.equal((await fetch(`${origin}/api/lab-results/conflicts?appointmentId=abc`)).status, 422);
    } finally {
      LabResult.updateMany = originalUpdateMany;
    }
  });

  it('移除抓檔程式紀錄：只有已經停掉的能移除', async () => {
    const remove = (id) => fetch(`${origin}/api/lab-results/bridge-status/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const originalFindOne = LabBridgeStatus.findOne;
    const originalDeleteOne = LabBridgeStatus.deleteOne;
    let deleted;
    LabBridgeStatus.deleteOne = async (filter) => { deleted = filter; };
    try {
      LabBridgeStatus.findOne = () => ({ lean: async () => ({ bridgeId: 'binghan', lastSeenAt: new Date(Date.now() - 10 * 60_000) }) });
      assert.equal((await remove('binghan')).status, 200);
      assert.deepEqual(deleted, { bridgeId: 'binghan' });

      deleted = null;
      LabBridgeStatus.findOne = () => ({ lean: async () => ({ bridgeId: 'BINGHAN', lastSeenAt: new Date() }) });
      assert.equal((await remove('BINGHAN')).status, 409);
      assert.equal(deleted, null);
    } finally {
      LabBridgeStatus.findOne = originalFindOne;
      LabBridgeStatus.deleteOne = originalDeleteOne;
    }
  });

  it('GET 預設列待配對，帶 petId 列那隻貓的', async () => {
    const filters = [];
    LabResult.find = (filter) => {
      filters.push(filter);
      return { sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [] }) }) }) };
    };
    LabResult.countDocuments = async () => 0;
    assert.equal((await fetch(`${origin}/api/lab-results`)).status, 200);
    assert.equal((await fetch(`${origin}/api/lab-results?petId=64b000000000000000000001`)).status, 200);
    assert.deepEqual(filters, [{ petId: null, dismissedAt: null }, { petId: '64b000000000000000000001' }]);
    assert.equal((await fetch(`${origin}/api/lab-results?petId=abc`)).status, 422);
  });

  it('待確認清單附上檢驗當天的候選掛號，同名唯一的預選', async () => {
    LabResult.find = () => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [
      { _id: 'lab-1', runAt: new Date('2026-09-30T02:00:00Z'), patient: { name: '牛奶' } },
    ] }) }) }) });
    LabResult.countDocuments = async () => 1;
    let visitFilter;
    Appointment.find = (filter) => {
      visitFilter = filter;
      return { select: () => ({ lean: async () => [
        { _id: 'v1', date: '2026-09-30', time: '15:00', petId: 'p1', petName: '牛奶', ownerName: '陳大文', status: 'arrived' },
        { _id: 'v2', date: '2026-09-30', time: '09:00', petId: 'p2', petName: '咖啡', ownerName: '林小姐', status: 'arrived' },
        { _id: 'v3', date: '2026-09-29', time: '09:00', petId: 'p3', petName: '牛奶', ownerName: '別天', status: 'arrived' },
      ] }) };
    };
    const { items } = await (await fetch(`${origin}/api/lab-results`)).json();
    // 台北 9/30 整天＝9/29 16:00Z～9/30 16:00Z。
    assert.equal(visitFilter.$or[0].scheduledAt.$gte.toISOString(), '2026-09-29T16:00:00.000Z');
    assert.deepEqual(items[0].candidates.map((candidate) => [candidate.petName, candidate.suggested]), [['牛奶', true], ['咖啡', false]]);
  });

  it('選貓：參數不對回 422，別台已經處理掉回 409', async () => {
    const id = '64b000000000000000000009';
    const post = (path, body) => fetch(`${origin}/api/lab-results/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
    });
    assert.equal((await post('abc/match', { petId: '64b000000000000000000001' })).status, 422);
    assert.equal((await post(`${id}/match`, { petId: 'abc' })).status, 422);
    Pet.exists = async () => ({ _id: '64b000000000000000000001' });
    LabResult.findOneAndUpdate = async () => null;
    assert.equal((await post(`${id}/match`, { petId: '64b000000000000000000001' })).status, 409);
    Pet.exists = async () => null;
    assert.equal((await post(`${id}/match`, { petId: '64b000000000000000000001' })).status, 404);
  });

  it('忽略：只有還在待確認清單上的能忽略', async () => {
    const id = '64b000000000000000000009';
    let filter;
    LabResult.findOneAndUpdate = async (value) => { filter = value; return { _id: id }; };
    const ok = await fetch(`${origin}/api/lab-results/${id}/dismiss`, { method: 'POST' });
    assert.equal(ok.status, 200);
    assert.deepEqual(filter, { _id: id, petId: null, dismissedAt: null });
    LabResult.findOneAndUpdate = async () => null;
    assert.equal((await fetch(`${origin}/api/lab-results/${id}/dismiss`, { method: 'POST' })).status, 409);
  });
});
