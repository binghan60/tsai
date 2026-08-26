import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import mongoose from 'mongoose';
import { app } from '../app.js';
import Appointment from '../models/Appointment.js';
import Pet from '../models/Pet.js';

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

  it('建立掛號時，初診沒填飼主姓名要回 422', async () => {
    const response = await fetch(`${origin}/api/appointments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { message: '請填寫飼主姓名' });
  });

  it('建立掛號時，petId 格式不正確要回 422', async () => {
    const response = await fetch(`${origin}/api/appointments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ petId: 'not-an-object-id' }),
    });
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { message: '寵物編號格式不正確' });
  });

  it('回診掛號一律用資料庫當下的飼主/寵物資料覆寫快照，不採信 body 帶的欄位', async () => {
    const originalFindById = Pet.findById;
    const originalCreate = Appointment.create;
    Pet.findById = () => ({
      populate: async () => ({
        _id: 'pet-1',
        name: '妞妞',
        species: '貓',
        ownerId: { _id: 'owner-1', name: '王小姐', phone: '0912-345-678' },
      }),
    });
    Appointment.create = async (doc) => doc;
    try {
      const response = await fetch(`${origin}/api/appointments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // 故意帶跟資料庫不一致的假快照，驗證後端不會採信它們。
        body: JSON.stringify({ petId: '507f1f77bcf86cd799439011', ownerName: '假名字', petName: '假寵物名' }),
      });
      assert.equal(response.status, 201);
      const body = await response.json();
      assert.equal(body.ownerName, '王小姐');
      assert.equal(body.ownerPhone, '0912-345-678');
      assert.equal(body.petName, '妞妞');
      assert.equal(body.species, '貓');
      assert.equal(body.ownerId, 'owner-1');
    } finally {
      Pet.findById = originalFindById;
      Appointment.create = originalCreate;
    }
  });

  it('報到時狀態機擋掉非法轉換（例如已完成的掛號不能再報到）', async () => {
    const originalFindById = Appointment.findById;
    Appointment.findById = async () => ({ _id: 'apt-1', status: 'completed', petId: 'pet-1' });
    try {
      const response = await fetch(`${origin}/api/appointments/apt-1/check-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(response.status, 422);
      assert.deepEqual(await response.json(), { message: '無法從「已完成」改為「報到」' });
    } finally {
      Appointment.findById = originalFindById;
    }
  });

  it('初診報到沒填寵物姓名要回 422', async () => {
    const originalFindById = Appointment.findById;
    Appointment.findById = async () => ({ _id: 'apt-2', status: 'scheduled', petId: null });
    try {
      const response = await fetch(`${origin}/api/appointments/apt-2/check-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ownerName: '林小姐', ownerPhone: '0955-888-777' }),
      });
      assert.equal(response.status, 422);
      assert.deepEqual(await response.json(), { message: '請填寫寵物姓名' });
    } finally {
      Appointment.findById = originalFindById;
    }
  });

  it('手動調整看診序號時，同一天號碼衝突要回 409', async () => {
    const originalFindById = Appointment.findById;
    const originalExists = Appointment.exists;
    Appointment.findById = async () => ({
      _id: 'apt-3',
      status: 'arrived',
      date: '2026-08-26',
      save: async () => {},
    });
    Appointment.exists = async () => true;
    try {
      const response = await fetch(`${origin}/api/appointments/apt-3`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ checkinNumber: 3 }),
      });
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { message: '這個看診序號已被使用' });
    } finally {
      Appointment.findById = originalFindById;
      Appointment.exists = originalExists;
    }
  });

  it('尚未報到的掛號可以編輯身分快照、時段與來院原因', async () => {
    const originalFindById = Appointment.findById;
    const appointment = {
      _id: 'apt-edit',
      status: 'scheduled',
      date: '2026-08-26',
      time: '10:00',
      ownerName: '王小姐',
      ownerPhone: '0912-000-000',
      petName: '妞妞',
      species: '貓',
      reason: '',
      scheduledAt: new Date('2026-08-26T02:00:00.000Z'),
      save: async () => {},
    };
    Appointment.findById = async () => appointment;
    try {
      const response = await fetch(`${origin}/api/appointments/apt-edit`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ownerName: '林小姐',
          ownerPhone: '0955-888-777',
          petName: '奶茶',
          species: '犬',
          time: '15:30',
          reason: '回診拿藥',
        }),
      });
      assert.equal(response.status, 200);
      assert.equal(appointment.ownerName, '林小姐');
      assert.equal(appointment.ownerPhone, '0955-888-777');
      assert.equal(appointment.petName, '奶茶');
      assert.equal(appointment.species, '犬');
      assert.equal(appointment.time, '15:30');
      assert.equal(appointment.reason, '回診拿藥');
      assert.equal(appointment.scheduledAt.toISOString(), '2026-08-26T07:30:00.000Z');
    } finally {
      Appointment.findById = originalFindById;
    }
  });

  it('成功報到時會記錄報到時間', async () => {
    const originalFindById = Appointment.findById;
    const originalExists = Appointment.exists;
    const originalStartSession = mongoose.startSession;
    const appointment = {
      _id: 'apt-checkin-time',
      status: 'scheduled',
      petId: 'pet-1',
      date: '2026-08-26',
      checkinNumber: null,
      checkedInAt: null,
      save: async () => {},
    };
    Appointment.findById = async () => appointment;
    Appointment.exists = () => ({ session: async () => false });
    mongoose.startSession = async () => ({
      withTransaction: async (callback) => callback(),
      endSession: async () => {},
    });
    try {
      const beforeCheckin = Date.now();
      const response = await fetch(`${origin}/api/appointments/apt-checkin-time/check-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ checkinNumber: 2 }),
      });
      assert.equal(response.status, 200);
      assert.equal(appointment.status, 'arrived');
      assert.equal(appointment.checkinNumber, 2);
      assert.ok(appointment.checkedInAt instanceof Date);
      assert.ok(appointment.checkedInAt.getTime() >= beforeCheckin);
    } finally {
      Appointment.findById = originalFindById;
      Appointment.exists = originalExists;
      mongoose.startSession = originalStartSession;
    }
  });

  it('已報到的掛號仍可編輯身分快照、時段與來院原因', async () => {
    const originalFindById = Appointment.findById;
    const appointment = {
      _id: 'apt-arrived-edit',
      status: 'arrived',
      date: '2026-08-26',
      time: '10:00',
      ownerName: '王小姐',
      ownerPhone: '0912-345-678',
      petName: '小白',
      species: '犬',
      reason: '例行檢查',
      scheduledAt: new Date('2026-08-26T02:00:00.000Z'),
      save: async () => {},
    };
    Appointment.findById = async () => appointment;
    try {
      const response = await fetch(`${origin}/api/appointments/apt-arrived-edit`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ownerName: '林小姐',
          ownerPhone: '0955-888-777',
          petName: '小黑',
          species: '貓',
          time: '10:30',
          reason: '臨時不適',
        }),
      });
      assert.equal(response.status, 200);
      assert.equal(appointment.ownerName, '林小姐');
      assert.equal(appointment.petName, '小黑');
      assert.equal(appointment.time, '10:30');
      assert.equal(appointment.reason, '臨時不適');
    } finally {
      Appointment.findById = originalFindById;
    }
  });

  it('完成看診時狀態機擋掉還沒報到就想結束的請求', async () => {
    const originalFindById = Appointment.findById;
    Appointment.findById = async () => ({ _id: 'apt-4', status: 'scheduled' });
    try {
      const response = await fetch(`${origin}/api/appointments/apt-4/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(response.status, 422);
      assert.deepEqual(await response.json(), { message: '無法從「已預約」改為「已完成」' });
    } finally {
      Appointment.findById = originalFindById;
    }
  });

  it('取消掛號會保存去除前後空白的取消原因', async () => {
    const originalFindById = Appointment.findById;
    const appointment = {
      _id: 'apt-5',
      status: 'scheduled',
      checkinNumber: null,
      cancelReason: '',
      save: async () => {},
    };
    Appointment.findById = async () => appointment;
    try {
      const response = await fetch(`${origin}/api/appointments/apt-5/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cancelReason: '  飼主臨時改期  ' }),
      });
      assert.equal(response.status, 200);
      assert.equal(appointment.status, 'cancelled');
      assert.equal(appointment.cancelReason, '飼主臨時改期');
    } finally {
      Appointment.findById = originalFindById;
    }
  });

  it('已取消掛號可恢復，且會清除取消原因', async () => {
    const originalFindById = Appointment.findById;
    const appointment = {
      _id: 'apt-6',
      status: 'cancelled',
      checkinNumber: null,
      cancelReason: '飼主臨時改期',
      save: async () => {},
    };
    Appointment.findById = async () => appointment;
    try {
      const response = await fetch(`${origin}/api/appointments/apt-6/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(response.status, 200);
      assert.equal(appointment.status, 'scheduled');
      assert.equal(appointment.cancelReason, '');
      assert.equal(appointment.checkinNumber, null);
    } finally {
      Appointment.findById = originalFindById;
    }
  });

  it('已報到掛號可取消報到，並清除看診序號', async () => {
    const originalFindById = Appointment.findById;
    const appointment = {
      _id: 'apt-arrived-restore',
      status: 'arrived',
      checkinNumber: 3,
      checkedInAt: new Date('2026-08-26T02:15:00.000Z'),
      cancelReason: '',
      save: async () => {},
    };
    Appointment.findById = async () => appointment;
    try {
      const response = await fetch(`${origin}/api/appointments/apt-arrived-restore/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(response.status, 200);
      assert.equal(appointment.status, 'scheduled');
      assert.equal(appointment.checkinNumber, null);
      assert.equal(appointment.checkedInAt, null);
    } finally {
      Appointment.findById = originalFindById;
    }
  });

  it('已完成掛號不可恢復', async () => {
    const originalFindById = Appointment.findById;
    Appointment.findById = async () => ({ _id: 'apt-7', status: 'completed' });
    try {
      const response = await fetch(`${origin}/api/appointments/apt-7/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(response.status, 422);
      assert.deepEqual(await response.json(), { message: '無法從「已完成」改為「已預約」' });
    } finally {
      Appointment.findById = originalFindById;
    }
  });

  it('已取消或未到的掛號可以永久刪除', async () => {
    const originalFindById = Appointment.findById;
    let deleted = false;
    Appointment.findById = async () => ({
      _id: 'apt-8',
      status: 'cancelled',
      deleteOne: async () => { deleted = true; },
    });
    try {
      const response = await fetch(`${origin}/api/appointments/apt-8`, { method: 'DELETE' });
      assert.equal(response.status, 204);
      assert.equal(deleted, true);
    } finally {
      Appointment.findById = originalFindById;
    }
  });

  it('尚在候診流程中的掛號不可刪除', async () => {
    const originalFindById = Appointment.findById;
    Appointment.findById = async () => ({ _id: 'apt-9', status: 'scheduled' });
    try {
      const response = await fetch(`${origin}/api/appointments/apt-9`, { method: 'DELETE' });
      assert.equal(response.status, 422);
      assert.deepEqual(await response.json(), { message: '只有已取消或未到的掛號可以刪除' });
    } finally {
      Appointment.findById = originalFindById;
    }
  });
});
