import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { app } from '../app.js';
import ClinicalNote from '../models/ClinicalNote.js';

// 掛號留言串同步出來的日誌（source: 'appointment'）內容是單向抄本——
// 這裡釘住「不能手動改內容」，以及「刪除只影響抄本，不會去動掛號」。
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

  it('掛號留言同步出來的日誌不可手動修改內容', async () => {
    const originalFindById = ClinicalNote.findById;
    const originalFindByIdAndUpdate = ClinicalNote.findByIdAndUpdate;
    let updateCalled = false;
    ClinicalNote.findById = async (id) => ({ _id: id, appointmentId: 'apt-linked', content: '原始留言記錄', source: 'appointment' });
    ClinicalNote.findByIdAndUpdate = async () => { updateCalled = true; };
    try {
      const response = await fetch(`${origin}/api/clinical-notes/note-linked`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: '想改掉的內容' }),
      });
      assert.equal(response.status, 422);
      assert.match((await response.json()).message, /掛號留言/);
      assert.equal(updateCalled, false);
    } finally {
      ClinicalNote.findById = originalFindById;
      ClinicalNote.findByIdAndUpdate = originalFindByIdAndUpdate;
    }
  });

  it('掛號留言同步出來的日誌仍可修改 entryDate（只擋 content）', async () => {
    const originalFindById = ClinicalNote.findById;
    const originalFindByIdAndUpdate = ClinicalNote.findByIdAndUpdate;
    ClinicalNote.findById = async (id) => ({ _id: id, appointmentId: 'apt-linked', content: '原始留言記錄', source: 'appointment' });
    ClinicalNote.findByIdAndUpdate = async (id, update) => ({ _id: id, ...update.$set });
    try {
      const response = await fetch(`${origin}/api/clinical-notes/note-linked`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entryDate: '2026-08-27T02:00:00.000Z' }),
      });
      assert.equal(response.status, 200);
    } finally {
      ClinicalNote.findById = originalFindById;
      ClinicalNote.findByIdAndUpdate = originalFindByIdAndUpdate;
    }
  });

  it('編輯一般手動日誌的內容不受影響', async () => {
    const originalFindById = ClinicalNote.findById;
    const originalFindByIdAndUpdate = ClinicalNote.findByIdAndUpdate;
    ClinicalNote.findById = async (id) => ({ _id: id, appointmentId: null, content: '單純手動記事', source: 'manual' });
    ClinicalNote.findByIdAndUpdate = async (id, update) => ({ _id: id, appointmentId: null, ...update.$set });
    try {
      const response = await fetch(`${origin}/api/clinical-notes/note-manual`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: '修改後的手動記事' }),
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).content, '修改後的手動記事');
    } finally {
      ClinicalNote.findById = originalFindById;
      ClinicalNote.findByIdAndUpdate = originalFindByIdAndUpdate;
    }
  });

  it('刪除掛號留言同步出來的日誌，只刪抄本，不會去動掛號本身', async () => {
    const originalFindByIdAndDelete = ClinicalNote.findByIdAndDelete;
    ClinicalNote.findByIdAndDelete = async (id) => ({ _id: id, appointmentId: 'apt-linked-2' });
    try {
      const response = await fetch(`${origin}/api/clinical-notes/note-linked-2`, { method: 'DELETE' });
      assert.equal(response.status, 204);
    } finally {
      ClinicalNote.findByIdAndDelete = originalFindByIdAndDelete;
    }
  });
});
