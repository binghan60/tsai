import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { app } from '../app.js';
import Pet from '../models/Pet.js';
import PinnedPet from '../models/PinnedPet.js';

const petId = '64b000000000000000000001';

function mockList(rows) {
  PinnedPet.find = () => ({ sort: () => ({ populate: () => ({ lean: async () => rows }) }) });
}

describe('pinned pets routes', () => {
  let server;
  let origin;
  const original = { find: PinnedPet.find, bulkWrite: PinnedPet.bulkWrite, deleteOne: PinnedPet.deleteOne, exists: Pet.exists };

  before(async () => {
    server = app.listen(0, '127.0.0.1');
    if (!server.listening) await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    Object.assign(PinnedPet, { find: original.find, bulkWrite: original.bulkWrite, deleteOne: original.deleteOne });
    Pet.exists = original.exists;
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it('GET 攤平寵物與飼主，並略過寵物已不存在的殘留紀錄', async () => {
    mockList([
      { _id: 'p1', pinnedBy: 'vet', source: 'manual', petId: { _id: petId, name: '豆豆', ownerId: { _id: 'o1', name: '王小明', phone: '0912' } } },
      { _id: 'p2', pinnedBy: 'vet', source: 'manual', petId: null },
    ]);
    const response = await fetch(`${origin}/api/pinned-pets`);
    assert.equal(response.status, 200);
    const { items } = await response.json();
    assert.equal(items.length, 1);
    assert.equal(items[0].petId, petId);
    assert.equal(items[0].pet.name, '豆豆');
    assert.equal(items[0].pet.owner.name, '王小明');
  });

  it('POST 手動加入走 upsert', async () => {
    let ops;
    Pet.exists = async () => ({ _id: petId });
    PinnedPet.bulkWrite = async (value) => { ops = value; };
    mockList([]);
    const response = await fetch(`${origin}/api/pinned-pets`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ petId, pinnedBy: 'vet' }),
    });
    assert.equal(response.status, 201);
    assert.equal(ops[0].updateOne.upsert, true);
    assert.equal(ops[0].updateOne.update.$set.source, 'manual');
  });

  it('POST 身分不正確或寵物不存在要擋', async () => {
    Pet.exists = async () => null;
    const badSender = await fetch(`${origin}/api/pinned-pets`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ petId, pinnedBy: 'someone' }),
    });
    assert.equal(badSender.status, 422);
    const missing = await fetch(`${origin}/api/pinned-pets`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ petId, pinnedBy: 'vet' }),
    });
    assert.equal(missing.status, 404);
  });

  it('DELETE 移除後回傳最新清單，已不在暫存區也算成功', async () => {
    let filter;
    PinnedPet.deleteOne = async (value) => { filter = value; return { deletedCount: 0 }; };
    mockList([]);
    const response = await fetch(`${origin}/api/pinned-pets/${petId}`, { method: 'DELETE' });
    assert.equal(response.status, 200);
    assert.equal(filter.petId, petId);
    assert.deepEqual((await response.json()).items, []);
  });
});
