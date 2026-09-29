import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { app } from '../app.js';
import LabResult from '../models/LabResult.js';
import LabBridgeStatus from '../models/LabBridgeStatus.js';
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
    assert.deepEqual(await response.json(), { status: 'created', id: 'lab-1' });
    assert.equal(saved.instrument, 'Catalyst_One');
    assert.equal(saved.patient.name, '娜娜');
    assert.equal(saved.assays.length, 4);
    assert.equal(saved.fileName, 'OO_娜娜_Catalyst_One.xml');
    assert.match(saved.rawXml, /<patient_name>娜娜<\/patient_name>/);
  });

  it('同一份再送一次只記收到次數，不覆寫內容與配對', async () => {
    process.env.IDEXX_BRIDGE_TOKEN = token;
    let update;
    mockExisting({ _id: 'lab-1', petId: 'pet-1', ...labResultContent(parseIdexxResult(catalyst)) });
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
    mockExisting({ _id: 'lab-1', petId: 'pet-1', ...old, messageAt: new Date('2000-01-01'), assays: old.assays.slice(0, 1) });
    LabResult.updateOne = async (_filter, value) => { update = value; };
    const response = await upload(catalyst);
    assert.equal((await response.json()).status, 'updated');
    assert.equal(update.$set.assays.length, 4);
    assert.ok(update.$set.revisedAt instanceof Date);
    assert.equal('petId' in update.$set, false);
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

  it('GET 預設列待配對，帶 petId 列那隻貓的', async () => {
    const filters = [];
    LabResult.find = (filter) => {
      filters.push(filter);
      return { sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [] }) }) }) };
    };
    LabResult.countDocuments = async () => 0;
    assert.equal((await fetch(`${origin}/api/lab-results`)).status, 200);
    assert.equal((await fetch(`${origin}/api/lab-results?petId=64b000000000000000000001`)).status, 200);
    assert.deepEqual(filters, [{ petId: null }, { petId: '64b000000000000000000001' }]);
    assert.equal((await fetch(`${origin}/api/lab-results?petId=abc`)).status, 422);
  });
});
