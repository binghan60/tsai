import { after, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { app } from '../app.js';
import ClinicalNote from '../models/ClinicalNote.js';
import Appointment from '../models/Appointment.js';
import MedicationOrder from '../models/MedicationOrder.js';
import mongoose from 'mongoose';

// 關聯日誌編輯會回寫掛號；手動日誌保留原有操作。
describe('clinical notes routes', () => {
  let server;
  let origin;
  let originalStartSession;

  before(async () => {
    originalStartSession = mongoose.startSession;
    mongoose.startSession = async () => ({ withTransaction: async callback => callback(), endSession: async () => {} });
    server = app.listen(0, '127.0.0.1');
    if (!server.listening) await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  beforeEach(() => {
    mock.restoreAll();
    mock.method(ClinicalNote, 'findById', id => ({ session: async () => id.includes('med') ? { appointmentId: null, medicationOrderId: 'order-1' } : id.includes('linked') ? { appointmentId: 'apt-linked' } : { appointmentId: null } }));
    mock.method(Appointment, 'find', () => ({ lean: async () => [] }));
  });

  after(async () => {
    mock.restoreAll();
    mongoose.startSession = originalStartSession;
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it('歷次日誌排除本次掛號後以每頁五筆分頁，總數使用相同條件', async () => {
    const appointmentId = '507f1f77bcf86cd799439011';
    const petId = '507f1f77bcf86cd799439012';
    const all = Array.from({ length: 12 }, (_, index) => ({ _id: String(index), content: `note ${index}` }));
    all[0].appointmentId = appointmentId;
    const filtered = all.slice(1);
    const expectedFilter = { petId, appointmentId: { $ne: appointmentId } };
    mock.method(ClinicalNote, 'find', filter => {
      assert.deepEqual(filter, expectedFilter);
      return { sort: () => ({ skip: offset => ({ limit: limit => Promise.resolve(filtered.slice(offset, offset + limit)) }) }) };
    });
    mock.method(ClinicalNote, 'countDocuments', async filter => {
      assert.deepEqual(filter, expectedFilter);
      return filtered.length;
    });
    for (const [page, count] of [[1, 5], [2, 5], [3, 1]]) {
      const response = await fetch(`${origin}/api/pets/${petId}/clinical-notes?page=${page}&limit=5&excludeAppointmentId=${appointmentId}`);
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.items.length, count);
      assert.equal(data.total, 11);
      assert.equal(data.totalPages, 3);
      assert.equal(data.items[0]._id, String((page - 1) * 5 + 1));
    }
  });

  it('編輯關聯日誌會回寫掛號的本次簡易紀錄', async () => {
    const originalFindByIdAndUpdate = ClinicalNote.findByIdAndUpdate;
    const originalAppointmentFindById = Appointment.findById;
    const appointment = {
      _id: 'apt-linked',
      visitNote: '舊內容',
      increment() {},
      async save() {},
    };
    ClinicalNote.findByIdAndUpdate = async (id, update) => ({ _id: id, appointmentId: 'apt-linked', ...update.$set });
    Appointment.findById = id => ({ session: async () => {
      assert.equal(id, 'apt-linked');
      return appointment;
    } });
    try {
      const response = await fetch(`${origin}/api/clinical-notes/note-linked`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: '改好的內容' }),
      });
      assert.equal(response.status, 200);
      assert.equal(appointment.visitNote, '改好的內容');
    } finally {
      ClinicalNote.findByIdAndUpdate = originalFindByIdAndUpdate;
      Appointment.findById = originalAppointmentFindById;
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

  it('拒絕刪除關聯日誌，不清空掛號', async () => {
    const originalFindByIdAndDelete = ClinicalNote.findByIdAndDelete;
    const originalAppointmentUpdate = Appointment.findByIdAndUpdate;
    let capturedAppointmentUpdate;
    ClinicalNote.findByIdAndDelete = async (id) => ({ _id: id, appointmentId: 'apt-linked-2' });
    Appointment.findByIdAndUpdate = async (id, update) => { capturedAppointmentUpdate = { id, update }; };
    try {
      const response = await fetch(`${origin}/api/clinical-notes/note-linked-2`, { method: 'DELETE' });
      assert.equal(response.status, 409);
      assert.equal(capturedAppointmentUpdate, undefined);
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

  it('藥單日誌是唯讀的：不能改內容、也不能單獨刪除', async () => {
    const put = await fetch(`${origin}/api/clinical-notes/note-med`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: '想改內文' }),
    });
    assert.equal(put.status, 409);
    assert.match((await put.json()).message, /藥單/);
    const del = await fetch(`${origin}/api/clinical-notes/note-med`, { method: 'DELETE' });
    assert.equal(del.status, 409);
  });

  it('列出寵物日誌時，藥單日誌的內文由藥單即時組成並標成唯讀，掛號日誌與手動日誌不受影響', async () => {
    const petId = '507f1f77bcf86cd799439012';
    const notes = [
      { _id: 'n1', petId, entryDate: '2026-09-22T02:00:00Z', source: 'medication', medicationOrderId: '507f1f77bcf86cd7994390aa' },
      { _id: 'n2', petId, entryDate: '2026-09-21T02:00:00Z', source: 'manual', content: '手動記事' },
      { _id: 'n3', petId, entryDate: '2026-09-20T02:00:00Z', source: 'medication', medicationOrderId: '507f1f77bcf86cd7994390bb' },
    ];
    let orderQuery;
    mock.method(ClinicalNote, 'find', () => ({ sort: () => ({ skip: () => ({ limit: async () => notes }) }) }));
    mock.method(ClinicalNote, 'countDocuments', async () => notes.length);
    mock.method(MedicationOrder, 'find', (filter) => {
      orderQuery = filter;
      return { select: (projection) => ({ lean: async () => { orderQuery.projection = projection; return [{ _id: '507f1f77bcf86cd7994390aa', status: 'approved', condition: '咳嗽', prescription: '止咳藥', note: '' }]; } }) };
    });
    const response = await fetch(`${origin}/api/pets/${petId}/clinical-notes`);
    assert.equal(response.status, 200);
    const { items } = await response.json();
    assert.equal(items[0].content, '領藥（待包藥）\n\n病況：咳嗽\n\n藥單：止咳藥');
    assert.equal(items[0].readOnly, true);
    assert.equal(items[1].content, '手動記事');
    assert.equal(items[1].readOnly, undefined);
    // 藥單被刪掉（或撈不到）時不讓整頁壞掉。
    assert.equal(items[2].content, '找不到對應的藥單資料');
    // 只撈需要的藥單，且不帶異動軌跡。
    assert.equal(orderQuery.projection, '-history');
    assert.equal(orderQuery._id.$in.length, 2);
  });
});
