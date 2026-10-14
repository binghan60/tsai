import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { app } from '../app.js';
import Drug from '../models/Drug.js';

const jsonHeaders = { 'content-type': 'application/json' };
const drugId = '64b0000000000000000000d1';

describe('drugs routes', () => {
  let server;
  let origin;
  const original = { find: Drug.find, findOne: Drug.findOne, findById: Drug.findById, updateOne: Drug.updateOne, insertMany: Drug.insertMany, findOneAndUpdate: Drug.findOneAndUpdate };

  before(async () => {
    server = app.listen(0, '127.0.0.1');
    if (!server.listening) await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    Object.assign(Drug, original);
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  const send = (method, path, body) => fetch(`${origin}/api/drugs${path}`, { method, headers: jsonHeaders, body: JSON.stringify(body) });

  it('批次新增：一行一筆，已經在藥櫃裡的（不分大小寫）略過', async () => {
    Drug.find = () => ({ select: () => ({ lean: async () => [{ nameKey: 'famotidine' }] }) });
    let inserted = [];
    Drug.insertMany = async (docs) => { inserted = docs; return docs; };
    const response = await send('POST', '', { names: 'Metoclopramide（胃排空劑）\nFamotidine\n\nmetoclopramide（胃排空劑）' });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.deepEqual(inserted.map((doc) => doc.name), ['Metoclopramide（胃排空劑）']);
    assert.equal(inserted[0].nameKey, 'metoclopramide（胃排空劑）');
    assert.deepEqual(body.skipped, ['Famotidine']);
    assert.equal(body.created[0].nameKey, undefined);
  });

  it('空白內容回 422', async () => {
    const response = await send('POST', '', { names: ' \n ' });
    assert.equal(response.status, 422);
  });

  it('改名撞到另一筆回 409，不寫入', async () => {
    Drug.findOne = () => ({ select: () => ({ lean: async () => ({ _id: 'other' }) }) });
    let wrote = false;
    Drug.findOneAndUpdate = () => { wrote = true; return { select: async () => null }; };
    const response = await send('PUT', `/${drugId}`, { name: 'famotidine', expectedVersion: 0 });
    assert.equal(response.status, 409);
    assert.equal(wrote, false);
  });

  it('常用：已經是常用的再存不改時間、取消清成 null、沒帶 pinned 不動', async () => {
    const pinnedAt = new Date('2026-10-01T00:00:00Z');
    Drug.findOne = () => ({ select: () => ({ lean: async () => null }) });
    Drug.findById = () => ({ select: () => ({ lean: async () => ({ pinnedAt }) }) });
    const sets = [];
    Drug.findOneAndUpdate = (filter, update) => { sets.push(update.$set); return { select: async () => ({ _id: drugId }) }; };
    for (const pinned of [true, false, undefined]) {
      const response = await send('PUT', `/${drugId}`, { name: 'Famotidine', expectedVersion: 0, pinned });
      assert.equal(response.status, 200);
    }
    assert.equal(sets[0].pinnedAt.toISOString(), pinnedAt.toISOString());
    assert.equal(sets[1].pinnedAt, null);
    assert.equal('pinnedAt' in sets[2], false);
  });

  it('使用次數分開記：點常用按鈕記 pinnedUsageCount，從建議清單選記 usageCount', async () => {
    const incs = [];
    Drug.updateOne = async (filter, update) => { incs.push(update.$inc); return { matchedCount: 1 }; };
    assert.equal((await send('POST', `/${drugId}/use`, { source: 'pinned' })).status, 204);
    assert.equal((await send('POST', `/${drugId}/use`, {})).status, 204);
    assert.deepEqual(incs, [{ pinnedUsageCount: 1 }, { usageCount: 1 }]);
  });

  it('修改要帶版本號', async () => {
    const response = await send('PUT', `/${drugId}`, { name: 'Famotidine' });
    assert.equal(response.status, 428);
  });
});
