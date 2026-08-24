import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { app } from '../app.js';
import Appointment from '../models/Appointment.js';

describe('appointments routes', () => {
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

  it('rejects creating an appointment without a date', async () => {
    const response = await fetch(`${origin}/api/appointments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ownerName: '王小明' }),
    });
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { message: '請填寫預約日期' });
  });

  it('rejects creating an appointment without an owner name', async () => {
    const response = await fetch(`${origin}/api/appointments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-08-24' }),
    });
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { message: '請填寫飼主姓名' });
  });

  it('rejects an illegal status transition', async () => {
    const originalFindById = Appointment.findById;
    Appointment.findById = async () => ({ _id: 'appt-1', status: 'completed' });
    try {
      const response = await fetch(`${origin}/api/appointments/appt-1/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'scheduled' }),
      });
      assert.equal(response.status, 422);
      assert.deepEqual(await response.json(), { message: '無法從「已完成」改為「已預約」' });
    } finally {
      Appointment.findById = originalFindById;
    }
  });

  it('is idempotent when create-patient is called on an already-linked appointment', async () => {
    const originalFindById = Appointment.findById;
    Appointment.findById = async () => ({ _id: 'appt-1', ownerId: 'owner-1', petId: 'pet-1' });
    try {
      const response = await fetch(`${origin}/api/appointments/appt-1/create-patient`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ownerId: 'owner-1', petId: 'pet-1' });
    } finally {
      Appointment.findById = originalFindById;
    }
  });

  it('requires a pet name before creating a first-visit patient', async () => {
    const originalFindById = Appointment.findById;
    Appointment.findById = async () => ({ _id: 'appt-1', petId: null, petName: '', species: '' });
    try {
      const response = await fetch(`${origin}/api/appointments/appt-1/create-patient`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      assert.equal(response.status, 422);
      assert.deepEqual(await response.json(), { message: '請填寫寵物名稱' });
    } finally {
      Appointment.findById = originalFindById;
    }
  });
});
