import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { app } from '../app.js';
import ClinicalNote from '../models/ClinicalNote.js';
import Appointment from '../models/Appointment.js';

// 完成看診時自動落地的日誌（source: 'appointment'）跟掛號的 visitNote 是同一份資料，
// 靠 ClinicalNote.appointmentId 互相同步；這裡釘住反方向（改／刪日誌回頭同步掛號）。
describe('clinical notes routes', () => {
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

  it('編輯來自掛號的日誌內容時，會同步回掛號的看診備註', async () => {
    const originalFindByIdAndUpdate = ClinicalNote.findByIdAndUpdate;
    const originalAppointmentUpdate = Appointment.findByIdAndUpdate;
    const appointmentUpdates = [];
    ClinicalNote.findByIdAndUpdate = async (id, update) => ({
      _id: id,
      appointmentId: 'apt-linked',
      content: update.$set.content,
      entryDate: new Date('2026-08-26T02:00:00.000Z'),
      source: 'appointment',
    });
    Appointment.findByIdAndUpdate = async (id, update) => {
      appointmentUpdates.push([id, update]);
      return {};
    };
    try {
      const response = await fetch(`${origin}/api/clinical-notes/note-linked`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: '修正後的看診備註' }),
      });
      assert.equal(response.status, 200);
      assert.equal(appointmentUpdates.length, 1);
      const [id, update] = appointmentUpdates[0];
      assert.equal(id, 'apt-linked');
      assert.equal(update.visitNote, '修正後的看診備註');
    } finally {
      ClinicalNote.findByIdAndUpdate = originalFindByIdAndUpdate;
      Appointment.findByIdAndUpdate = originalAppointmentUpdate;
    }
  });

  it('編輯一般手動日誌不會去動任何掛號', async () => {
    const originalFindByIdAndUpdate = ClinicalNote.findByIdAndUpdate;
    const originalAppointmentUpdate = Appointment.findByIdAndUpdate;
    let appointmentUpdateCalled = false;
    ClinicalNote.findByIdAndUpdate = async (id, update) => ({
      _id: id,
      appointmentId: null,
      content: update.$set.content,
      source: 'manual',
    });
    Appointment.findByIdAndUpdate = async () => { appointmentUpdateCalled = true; };
    try {
      const response = await fetch(`${origin}/api/clinical-notes/note-manual`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: '單純手動記事' }),
      });
      assert.equal(response.status, 200);
      assert.equal(appointmentUpdateCalled, false);
    } finally {
      ClinicalNote.findByIdAndUpdate = originalFindByIdAndUpdate;
      Appointment.findByIdAndUpdate = originalAppointmentUpdate;
    }
  });

  it('刪除來自掛號的日誌時，掛號的看診備註會清空', async () => {
    const originalFindByIdAndDelete = ClinicalNote.findByIdAndDelete;
    const originalAppointmentUpdate = Appointment.findByIdAndUpdate;
    const appointmentUpdates = [];
    ClinicalNote.findByIdAndDelete = async (id) => ({ _id: id, appointmentId: 'apt-linked-2' });
    Appointment.findByIdAndUpdate = async (id, update) => { appointmentUpdates.push([id, update]); return {}; };
    try {
      const response = await fetch(`${origin}/api/clinical-notes/note-linked-2`, { method: 'DELETE' });
      assert.equal(response.status, 204);
      assert.equal(appointmentUpdates.length, 1);
      const [id, update] = appointmentUpdates[0];
      assert.equal(id, 'apt-linked-2');
      assert.equal(update.visitNote, '');
    } finally {
      ClinicalNote.findByIdAndDelete = originalFindByIdAndDelete;
      Appointment.findByIdAndUpdate = originalAppointmentUpdate;
    }
  });
});
