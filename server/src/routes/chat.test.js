import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { app } from '../app.js';
import mongoose from 'mongoose';
import ChatMessage from '../models/ChatMessage.js';
import Pet from '../models/Pet.js';
import PinnedPet from '../models/PinnedPet.js';

describe('chat routes', () => {
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

  it('GET /messages 回傳依時間正序排列的最近訊息', async () => {
    const originalFind = ChatMessage.find;
    const rows = [
      { _id: 'm3', sender: 'front_desk', content: '第三則', createdAt: new Date('2026-08-26T03:00:00.000Z') },
      { _id: 'm2', sender: 'vet', content: '第二則', createdAt: new Date('2026-08-26T02:00:00.000Z') },
      { _id: 'm1', sender: 'vet', content: '第一則', createdAt: new Date('2026-08-26T01:00:00.000Z') },
    ];
    let capturedLimit;
    ChatMessage.find = () => ({
      sort: () => ({
        limit: (limit) => { capturedLimit = limit; return Promise.resolve(rows); },
      }),
    });
    try {
      const response = await fetch(`${origin}/api/chat/messages`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(capturedLimit, 100);
      assert.deepEqual(body.items.map((item) => item._id), ['m1', 'm2', 'm3']);
    } finally {
      ChatMessage.find = originalFind;
    }
  });

  it('POST /messages 建立訊息並透過 Socket.IO 廣播', async () => {
    const originalCreate = ChatMessage.create;
    let capturedDoc;
    ChatMessage.create = async (doc) => { capturedDoc = doc; return { _id: 'new-msg', ...doc, createdAt: new Date() }; };
    try {
      const response = await fetch(`${origin}/api/chat/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sender: 'vet', content: '今天下午提早關診' }),
      });
      assert.equal(response.status, 201);
      const body = await response.json();
      assert.equal(body.sender, 'vet');
      assert.equal(body.content, '今天下午提早關診');
      assert.equal(capturedDoc.sender, 'vet');
      assert.equal(capturedDoc.content, '今天下午提早關診');
      assert.equal(capturedDoc.auto, false);
    } finally {
      ChatMessage.create = originalCreate;
    }
  });

  it('POST /messages 可以標記為掛號頁自動發送的訊息', async () => {
    const originalCreate = ChatMessage.create;
    let capturedDoc;
    ChatMessage.create = async (doc) => { capturedDoc = doc; return { _id: 'new-msg', ...doc, createdAt: new Date() }; };
    try {
      const response = await fetch(`${origin}/api/chat/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sender: 'front_desk', content: '王小明已報到', auto: true }),
      });
      assert.equal(response.status, 201);
      assert.equal(capturedDoc.auto, true);
      assert.equal((await response.json()).auto, true);
    } finally {
      ChatMessage.create = originalCreate;
    }
  });

  it('自動通知完整保存修改前後快照，支援長紀錄與清空', async () => {
    const originalCreate = ChatMessage.create;
    ChatMessage.create = async values => {
      const doc = new ChatMessage(values);
      await doc.validate();
      return doc.toObject();
    };
    try {
      const snapshot = { fieldLabel: '本次簡易紀錄', before: '原始紀錄\n'.repeat(300), after: '' };
      const response = await fetch(`${origin}/api/chat/messages`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sender: 'front_desk', content: '本次紀錄已更新', auto: true, snapshot }),
      });
      assert.equal(response.status, 201);
      assert.deepEqual((await response.json()).snapshot, snapshot);
    } finally { ChatMessage.create = originalCreate; }
  });

  it('快照欄位格式錯誤時拒絕建立', async () => {
    const response = await fetch(`${origin}/api/chat/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sender: 'front_desk', content: '更新', auto: true, snapshot: { before: {}, after: '' } }),
    });
    assert.equal(response.status, 422);
  });

  it('@ 標記寵物時由伺服器寫入名字快照，並放進暫存區', async () => {
    const petId = '64b000000000000000000001';
    const original = { create: ChatMessage.create, find: Pet.find, bulkWrite: PinnedPet.bulkWrite, pinFind: PinnedPet.find };
    const originalStartSession = mongoose.startSession;
    let createdDocs;
    let pinOps;
    mongoose.startSession = async () => ({ withTransaction: async (callback) => callback(), endSession: async () => {} });
    Pet.find = () => ({ select: () => ({ populate: () => ({ lean: async () => [{ _id: petId, name: '豆豆', ownerId: { name: '王小明' } }] }) }) });
    ChatMessage.create = async (docs) => { createdDocs = docs; return docs.map((doc) => ({ _id: '64b0000000000000000000aa', ...doc })); };
    PinnedPet.bulkWrite = async (ops) => { pinOps = ops; };
    PinnedPet.find = () => ({ sort: () => ({ populate: () => ({ lean: async () => [] }) }) });
    try {
      const response = await fetch(`${origin}/api/chat/messages`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sender: 'front_desk', content: '@假名字 飼主來電問藥', mentions: [petId, petId] }),
      });
      assert.equal(response.status, 201);
      assert.deepEqual(createdDocs[0].mentions, [{ petId, petName: '豆豆', ownerName: '王小明' }]);
      assert.equal(pinOps.length, 1);
      assert.equal(pinOps[0].updateOne.filter.petId, petId);
      assert.equal(pinOps[0].updateOne.update.$set.pinnedBy, 'front_desk');
      assert.equal(pinOps[0].updateOne.update.$set.source, 'mention');
      assert.equal(pinOps[0].updateOne.upsert, true);
    } finally {
      ChatMessage.create = original.create;
      Pet.find = original.find;
      PinnedPet.bulkWrite = original.bulkWrite;
      PinnedPet.find = original.pinFind;
      mongoose.startSession = originalStartSession;
    }
  });

  it('標記不存在的寵物要回 422', async () => {
    const originalFind = Pet.find;
    Pet.find = () => ({ select: () => ({ populate: () => ({ lean: async () => [] }) }) });
    try {
      const response = await fetch(`${origin}/api/chat/messages`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sender: 'vet', content: '@豆豆', mentions: ['64b000000000000000000009'] }),
      });
      assert.equal(response.status, 422);
    } finally {
      Pet.find = originalFind;
    }
  });

  it('標記格式不正確要回 422', async () => {
    const response = await fetch(`${origin}/api/chat/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sender: 'vet', content: '@豆豆', mentions: ['not-an-id'] }),
    });
    assert.equal(response.status, 422);
  });

  it('身分參數不正確要回 422', async () => {
    const response = await fetch(`${origin}/api/chat/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sender: 'someone', content: '內容' }),
    });
    assert.equal(response.status, 422);
    assert.match((await response.json()).message, /身分/);
  });

  it('訊息內容不可為空', async () => {
    const response = await fetch(`${origin}/api/chat/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sender: 'vet', content: '   ' }),
    });
    assert.equal(response.status, 422);
    assert.match((await response.json()).message, /不可為空/);
  });
});
