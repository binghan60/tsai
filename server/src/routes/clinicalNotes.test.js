import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { app } from '../app.js';
import ClinicalNote from '../models/ClinicalNote.js';
import Appointment from '../models/Appointment.js';

// 完成看診／候診中同步落地的日誌（source: 'appointment'）內容跟掛號的 visitNote
// 是同一份資料，雙向同步——這裡釘住「改日誌內容會回寫掛號」與「刪除日誌會清空備註」。
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

  it('編輯掛號同步出來的日誌內容，會回寫掛號的 visitNote', async () => {
    const originalFindByIdAndUpdate = ClinicalNote.findByIdAndUpdate;
    const originalAppointmentUpdate = Appointment.findByIdAndUpdate;
    let capturedAppointmentUpdate;
    ClinicalNote.findByIdAndUpdate = async (id, update) => ({ _id: id, appointmentId: 'apt-linked', content: update.$set.content });
    Appointment.findByIdAndUpdate = async (id, update) => { capturedAppointmentUpdate = { id, update }; };
    try {
      const response = await fetch(`${origin}/api/clinical-notes/note-linked`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: '改好的內容' }),
      });
      assert.equal(response.status, 200);
      assert.equal(capturedAppointmentUpdate.id, 'apt-linked');
      assert.equal(capturedAppointmentUpdate.update.visitNote, '改好的內容');
    } finally {
      ClinicalNote.findByIdAndUpdate = originalFindByIdAndUpdate;
      Appointment.findByIdAndUpdate = originalAppointmentUpdate;
    }
  });

  it('編輯一般手動日誌的內容不受影響，也不會去動任何掛號', async () => {
    const originalFindByIdAndUpdate = ClinicalNote.findByIdAndUpdate;
    const originalAppointmentUpdate = Appointment.findByIdAndUpdate;
    let appointmentUpdateCalled = false;
    ClinicalNote.findByIdAndUpdate = async (id, update) => ({ _id: id, appointmentId: null, ...update.$set });
    Appointment.findByIdAndUpdate = async () => { appointmentUpdateCalled = true; };
    try {
      const response = await fetch(`${origin}/api/clinical-notes/note-manual`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: '修改後的手動記事' }),
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).content, '修改後的手動記事');
      assert.equal(appointmentUpdateCalled, false);
    } finally {
      ClinicalNote.findByIdAndUpdate = originalFindByIdAndUpdate;
      Appointment.findByIdAndUpdate = originalAppointmentUpdate;
    }
  });

  it('日誌不存在時回 404', async () => {
    const originalFindByIdAndUpdate = ClinicalNote.findByIdAndUpdate;
    ClinicalNote.findByIdAndUpdate = async () => null;
    try {
      const response = await fetch(`${origin}/api/clinical-notes/missing`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: '不存在' }),
      });
      assert.equal(response.status, 404);
    } finally {
      ClinicalNote.findByIdAndUpdate = originalFindByIdAndUpdate;
    }
  });

  it('刪除掛號同步出來的日誌，會清空掛號的 visitNote', async () => {
    const originalFindByIdAndDelete = ClinicalNote.findByIdAndDelete;
    const originalAppointmentUpdate = Appointment.findByIdAndUpdate;
    let capturedAppointmentUpdate;
    ClinicalNote.findByIdAndDelete = async (id) => ({ _id: id, appointmentId: 'apt-linked-2' });
    Appointment.findByIdAndUpdate = async (id, update) => { capturedAppointmentUpdate = { id, update }; };
    try {
      const response = await fetch(`${origin}/api/clinical-notes/note-linked-2`, { method: 'DELETE' });
      assert.equal(response.status, 204);
      assert.equal(capturedAppointmentUpdate.id, 'apt-linked-2');
      assert.equal(capturedAppointmentUpdate.update.visitNote, '');
    } finally {
      ClinicalNote.findByIdAndDelete = originalFindByIdAndDelete;
      Appointment.findByIdAndUpdate = originalAppointmentUpdate;
    }
  });

  it('刪除一般手動日誌不會去動任何掛號', async () => {
    const originalFindByIdAndDelete = ClinicalNote.findByIdAndDelete;
    const originalAppointmentUpdate = Appointment.findByIdAndUpdate;
    let appointmentUpdateCalled = false;
    ClinicalNote.findByIdAndDelete = async (id) => ({ _id: id, appointmentId: null });
    Appointment.findByIdAndUpdate = async () => { appointmentUpdateCalled = true; };
    try {
      const response = await fetch(`${origin}/api/clinical-notes/note-manual-2`, { method: 'DELETE' });
      assert.equal(response.status, 204);
      assert.equal(appointmentUpdateCalled, false);
    } finally {
      ClinicalNote.findByIdAndDelete = originalFindByIdAndDelete;
      Appointment.findByIdAndUpdate = originalAppointmentUpdate;
    }
  });
});
