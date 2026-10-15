import { after, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import mongoose from 'mongoose';
import { app } from '../app.js';
import Appointment from '../models/Appointment.js';
import Owner from '../models/Owner.js';
import Pet from '../models/Pet.js';

// 換飼主（流浪貓被認養）與流浪貓標記。
const petId = '507f1f77bcf86cd799439061';
const clinicOwnerId = '507f1f77bcf86cd799439062';
const adopterId = '507f1f77bcf86cd799439063';
const scheduledId = '507f1f77bcf86cd799439064';

function query(read) {
  const q = {
    select: () => q, populate: () => q, lean: () => q, session: () => q, sort: () => q, limit: () => q,
    then: (resolve, reject) => Promise.resolve().then(read).then(resolve, reject),
  };
  return q;
}

describe('換飼主與流浪貓標記', () => {
  let server, origin, petUpdates, appointmentUpdates, ownerBumps, createdOwners;
  before(async () => {
    server = app.listen(0, '127.0.0.1');
    if (!server.listening) await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}/api`;
  });
  after(async () => { mock.restoreAll(); await new Promise((resolve) => server.close(resolve)); });
  beforeEach(() => {
    mock.restoreAll();
    petUpdates = [];
    appointmentUpdates = [];
    ownerBumps = [];
    createdOwners = [];
    mock.method(mongoose, 'startSession', async () => ({ withTransaction: async (callback) => callback({}), endSession: async () => {} }));
    mock.method(Pet, 'findById', () => query(() => ({ _id: petId, __v: 3, ownerId: { _id: clinicOwnerId, kind: 'clinic' }, isStray: true })));
    mock.method(Pet, 'findOneAndUpdate', (filter, update) => query(() => {
      petUpdates.push({ filter, update });
      return { _id: petId, __v: 4, ...update.$set };
    }));
    mock.method(Owner, 'findOneAndUpdate', (filter) => query(() => {
      ownerBumps.push(String(filter._id));
      return String(filter._id) === adopterId ? { _id: adopterId, name: '張小姐', phone: '0988123456', kind: '' } : null;
    }));
    mock.method(Owner, 'updateOne', (filter) => query(() => { ownerBumps.push(String(filter._id)); return { matchedCount: 1 }; }));
    mock.method(Owner, 'create', async ([data]) => { const doc = new Owner(data); createdOwners.push(doc); return [doc]; });
    mock.method(Appointment, 'find', () => query(() => [{ _id: scheduledId, date: '2026-10-20' }]));
    mock.method(Appointment, 'updateMany', (filter, update) => query(() => { appointmentUpdates.push({ filter, update }); return { modifiedCount: 1 }; }));
  });

  const send = async (method, path, body) => {
    const response = await fetch(`${origin}${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };

  it('換到既有飼主並拿掉流浪貓標記：新舊飼主都鎖住，還沒報到的掛號換成新飼主', async () => {
    // Pet.findById 在 transaction 裡回的是沒有 populate 的文件。
    mock.method(Pet, 'findById', () => query(() => ({ _id: petId, __v: 3, ownerId: clinicOwnerId, isStray: true })));
    const { status } = await send('POST', `/pets/${petId}/transfer-owner`, { expectedVersion: 3, ownerId: adopterId, clearStray: true });
    assert.equal(status, 200);
    assert.deepEqual(petUpdates[0].update.$set, { ownerId: adopterId, isStray: false });
    assert.deepEqual(new Set(ownerBumps), new Set([adopterId, clinicOwnerId]));
    const moved = appointmentUpdates.find((entry) => entry.update.$set.ownerId);
    assert.equal(moved.update.$set.ownerName, '張小姐');
    assert.equal(moved.update.$set.ownerPhone, '0988123456');
    assert.equal(moved.update.$set.isStray, false);
    assert.deepEqual(moved.update.$inc, { __v: 1 });
  });

  it('換給新飼主：一起建立，手機要是手機', async () => {
    mock.method(Pet, 'findById', () => query(() => ({ _id: petId, __v: 3, ownerId: clinicOwnerId, isStray: true })));
    assert.equal((await send('POST', `/pets/${petId}/transfer-owner`, { expectedVersion: 3, owner: { name: '張小姐', phone: '02-2345-6789' } })).status, 422);
    const { status } = await send('POST', `/pets/${petId}/transfer-owner`, { expectedVersion: 3, owner: { name: '張小姐', phone: '0988-123-456' } });
    assert.equal(status, 200);
    assert.equal(createdOwners[0].phone, '0988123456');
    assert.equal(petUpdates[0].update.$set.isStray, true, '沒勾拿掉標記就留著');
  });

  it('版本不符回 409，什麼都不改', async () => {
    mock.method(Pet, 'findById', () => query(() => ({ _id: petId, __v: 5, ownerId: clinicOwnerId, isStray: true })));
    assert.equal((await send('POST', `/pets/${petId}/transfer-owner`, { expectedVersion: 3, ownerId: adopterId })).status, 409);
    assert.equal(petUpdates.length, 0);
  });

  it('院內的貓不能直接拿掉流浪貓標記', async () => {
    const { status, body } = await send('PUT', `/pets/${petId}`, { expectedVersion: 3, isStray: false });
    assert.equal(status, 422);
    assert.match(body.message, /換飼主/);
    assert.equal(petUpdates.length, 0);
  });
});
