import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { app } from './app.js';
import MedicalRecord from './models/MedicalRecord.js';

describe('health endpoints', () => {
  let server;
  let origin;

  before(async () => {
    server = app.listen(0, '127.0.0.1');
    if (!server.listening) await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it('liveness does not depend on the database', async () => {
    const response = await fetch(`${origin}/api/health/live`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  });

  it('readiness reports unavailable while MongoDB is disconnected', async () => {
    const response = await fetch(`${origin}/api/health`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'unavailable', database: 'disconnected' });
  });

  it('refuses to finalize a draft that changed after the preview was loaded', async () => {
    const originalFindById = MedicalRecord.findById;
    MedicalRecord.findById = async () => ({ _id: 'record-1', status: 'draft', __v: 7 });
    try {
      const response = await fetch(`${origin}/api/records/record-1/finalize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedVersion: 6 }),
      });
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), {
        message: '病歷在預覽後已被更新。系統已重新載入最新內容，請確認後再結案。',
        currentVersion: 7,
      });
    } finally {
      MedicalRecord.findById = originalFindById;
    }
  });

  it('requires an explicit preview version before finalization', async () => {
    const originalFindById = MedicalRecord.findById;
    MedicalRecord.findById = async () => ({ _id: 'record-1', status: 'draft', __v: 7 });
    try {
      const response = await fetch(`${origin}/api/records/record-1/finalize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      assert.equal(response.status, 428);
      assert.deepEqual(await response.json(), { message: '缺少預覽版本資訊，請重新整理報告後再結案' });
    } finally {
      MedicalRecord.findById = originalFindById;
    }
  });

  it('requires a document version when updating an owner', async () => {
    const response = await fetch(`${origin}/api/owners/owner-1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '王小明', phone: '0912345678', email: '' }),
    });
    assert.equal(response.status, 428);
    assert.deepEqual(await response.json(), { message: '缺少飼主資料版本，請重新整理後再試' });
  });

  it('requires a document version when updating a pet', async () => {
    const response = await fetch(`${origin}/api/pets/pet-1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '小白' }),
    });
    assert.equal(response.status, 428);
    assert.deepEqual(await response.json(), { message: '缺少寵物資料版本，請重新整理後再試' });
  });
});
