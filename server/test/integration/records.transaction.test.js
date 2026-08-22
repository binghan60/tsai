import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import mongoose from 'mongoose';
import { app } from '../../src/app.js';
import DeletedMedicalRecord from '../../src/models/DeletedMedicalRecord.js';
import MedicalRecord from '../../src/models/MedicalRecord.js';
import Owner from '../../src/models/Owner.js';
import Pet from '../../src/models/Pet.js';

const uri = process.env.TEST_MONGODB_URI?.trim();

describe('record transaction workflow against a replica set', { skip: !uri }, () => {
  let server;
  let origin;
  let owner;
  let pet;
  let record;

  before(async () => {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    if (!/test/i.test(mongoose.connection.name)) {
      throw new Error('TEST_MONGODB_URI 必須指向名稱含 test 的隔離測試資料庫');
    }
    server = app.listen(0, '127.0.0.1');
    if (!server.listening) await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (record?._id) {
      await MedicalRecord.deleteOne({ _id: record._id }).catch(() => {});
      await DeletedMedicalRecord.deleteOne({ originalId: record._id }).catch(() => {});
    }
    if (pet?._id) await Pet.deleteOne({ _id: pet._id }).catch(() => {});
    if (owner?._id) await Owner.deleteOne({ _id: owner._id }).catch(() => {});
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
  });

  it('archives and restores a medical record atomically', async () => {
    owner = await Owner.create({ name: '整合測試飼主', phone: '0900000000' });
    pet = await Pet.create({ ownerId: owner._id, name: '整合測試寵物', species: '犬' });
    record = await MedicalRecord.create({ petId: pet._id, visitDate: new Date('2026-08-20T00:00:00.000Z') });

    const deletedResponse = await fetch(`${origin}/api/records/${record._id}`, { method: 'DELETE' });
    assert.equal(deletedResponse.status, 204);
    assert.equal(await MedicalRecord.exists({ _id: record._id }), null);

    const audit = await DeletedMedicalRecord.findOne({ originalId: record._id });
    assert.ok(audit);
    assert.equal(audit.petName, pet.name);

    const restoredResponse = await fetch(`${origin}/api/records/trash/${audit._id}/restore`, { method: 'POST' });
    assert.equal(restoredResponse.status, 201);
    assert.ok(await MedicalRecord.exists({ _id: record._id }));
    assert.ok((await DeletedMedicalRecord.findById(audit._id)).restoredAt);
  });
});
