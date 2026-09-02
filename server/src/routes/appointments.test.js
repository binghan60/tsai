import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import mongoose from 'mongoose';
import { app } from '../app.js';
import Appointment from '../models/Appointment.js';
import Pet from '../models/Pet.js';
import FormTemplate from '../models/FormTemplate.js';
import MedicalRecord from '../models/MedicalRecord.js';
import ClinicSettings from '../models/ClinicSettings.js';
import { clinicToday } from '../lib/clinicTime.js';
import { enumerateDates, fillDailyCounts } from './appointments.js';

// 號碼牌相關路由會走 Appointment.find(...).session(...)（報到那條再接 .where(...)）。
// 這裡把查詢鏈與 transaction 假掉，並監看是否誤用 bulkWrite 改到其他人的牌號。
function stubQueue(rows) {
  const chain = {
    session: () => chain,
    where: () => chain,
    then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
  };
  return chain;
}

function captureQueueWrites() {
  const calls = [];
  const original = { find: Appointment.find, bulkWrite: Appointment.bulkWrite, startSession: mongoose.startSession };
  Appointment.bulkWrite = async (operations) => {
    calls.push(operations.map((op) => ({
      _id: op.updateOne.filter._id,
      checkinNumber: op.updateOne.update.$set.checkinNumber,
    })));
  };
  mongoose.startSession = async () => ({
    withTransaction: async (callback) => callback(),
    endSession: async () => {},
  });
  return {
    // 實體牌號不該整批重排；保留這些資訊是為了讓測試能明確釘住「沒有 bulkWrite」。
    get positions() { return calls.at(-1) ?? []; },
    get phases() { return calls.length; },
    restore() {
      Appointment.find = original.find;
      Appointment.bulkWrite = original.bulkWrite;
      mongoose.startSession = original.startSession;
    },
  };
}

describe('appointments routes', () => {
  let server;
  let origin;
  let originalTemplateFindOne;
  let originalSettingsFindOne;
  let originalRecordCreate;

  before(async () => {
    originalTemplateFindOne = FormTemplate.findOne;
    originalSettingsFindOne = ClinicSettings.findOne;
    originalRecordCreate = MedicalRecord.create;
    FormTemplate.findOne = async () => ({ _id: '507f1f77bcf86cd799439011', name: '預設表單', version: 1 });
    ClinicSettings.findOne = () => ({ lean: async () => ({ defaultAppointmentTemplateId: '507f1f77bcf86cd799439011' }) });
    MedicalRecord.create = async ([record]) => [{ _id: 'record-1', ...record }];
    server = app.listen(0, '127.0.0.1');
    if (!server.listening) await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    FormTemplate.findOne = originalTemplateFindOne;
    ClinicSettings.findOne = originalSettingsFindOne;
    MedicalRecord.create = originalRecordCreate;
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  // 頁面上的日期面板選了哪一天，掛號就要掛在那一天。看著 8/29 卻掛到今天，
  // 是這個功能最容易發生也最難發現的錯，所以直接釘住。
  it('掛號會掛在 body 指定的日期，scheduledAt 也跟著那一天算', async () => {
    const originalCreate = Appointment.create;
    Appointment.create = async (doc) => doc;
    try {
      const response = await fetch(`${origin}/api/appointments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ petName: '妞妞', date: '2026-09-01', time: '10:00' }),
      });
      assert.equal(response.status, 201);
      const body = await response.json();
      assert.equal(body.date, '2026-09-01');
      // 10:00 台北 = 02:00 UTC。時段換算要用掛號那一天，不是今天。
      assert.equal(body.scheduledAt, '2026-09-01T02:00:00.000Z');
    } finally {
      Appointment.create = originalCreate;
    }
  });

  it('沒帶日期就掛在今天', async () => {
    const originalCreate = Appointment.create;
    Appointment.create = async (doc) => doc;
    try {
      const response = await fetch(`${origin}/api/appointments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ petName: '妞妞', time: '10:00' }),
      });
      assert.equal(response.status, 201);
      assert.equal((await response.json()).date, clinicToday());
    } finally {
      Appointment.create = originalCreate;
    }
  });

  it('日期格式不對就退回今天，不會存進一個壞掉的 date', async () => {
    const originalCreate = Appointment.create;
    Appointment.create = async (doc) => doc;
    try {
      const response = await fetch(`${origin}/api/appointments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ petName: '妞妞', date: '2026/09/01', time: '10:00' }),
      });
      assert.equal(response.status, 201);
      assert.equal((await response.json()).date, clinicToday());
    } finally {
      Appointment.create = originalCreate;
    }
  });

  // 沒填時段時，排序基準要落在掛號的那一天。用「現在」的話，
  // 掛在未來某天的那筆會排到那天清單的最前面。
  it('未來日期沒填時段時，scheduledAt 落在那一天的開頭而不是現在', async () => {
    const originalCreate = Appointment.create;
    Appointment.create = async (doc) => doc;
    try {
      const response = await fetch(`${origin}/api/appointments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ petName: '妞妞', date: '2030-09-01' }),
      });
      assert.equal(response.status, 201);
      // 2030-09-01 00:00 台北 = 2030-08-31T16:00:00.000Z
      assert.equal((await response.json()).scheduledAt, '2030-08-31T16:00:00.000Z');
    } finally {
      Appointment.create = originalCreate;
    }
  });

  // 飼主姓名選填，但一筆掛號至少要指得出是誰要來。
  it('建立掛號時，初診沒填寵物姓名要回 422', async () => {
    const response = await fetch(`${origin}/api/appointments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ownerName: '王小姐' }),
    });
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { message: '請填寫寵物姓名' });
  });

  it('初診只填寵物姓名就能掛號，飼主姓名可以留空', async () => {
    const originalCreate = Appointment.create;
    Appointment.create = async (doc) => doc;
    try {
      const response = await fetch(`${origin}/api/appointments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // 即使呼叫端亂報成回診，後端仍要依有沒有既有 petId 判斷。
        body: JSON.stringify({ petName: '妞妞', ownerPhone: '0912-345-678', time: '10:00', visitType: 'return' }),
      });
      assert.equal(response.status, 201);
      const body = await response.json();
      assert.equal(body.petName, '妞妞');
      assert.equal(body.ownerName, '');
      assert.equal(body.ownerPhone, '0912-345-678');
      assert.equal(body.visitType, 'new');
    } finally {
      Appointment.create = originalCreate;
    }
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
        body: JSON.stringify({ petId: '507f1f77bcf86cd799439011', visitType: 'new', ownerName: '假名字', petName: '假寵物名' }),
      });
      assert.equal(response.status, 201);
      const body = await response.json();
      assert.equal(body.ownerName, '王小姐');
      assert.equal(body.ownerPhone, '0912-345-678');
      assert.equal(body.petName, '妞妞');
      assert.equal(body.species, '貓');
      assert.equal(body.ownerId, 'owner-1');
      assert.equal(body.visitType, 'return');
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

  it('掛號時段只接受診所時段內的五分鐘刻度', async () => {
    for (const time of ['09:55', '11:35', '12:00', '14:02', '19:35']) {
      const response = await fetch(`${origin}/api/appointments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ time }),
      });
      assert.equal(response.status, 422, time);
      assert.deepEqual(await response.json(), {
        message: '預約時段僅限 10:00–11:30、14:00–19:30，且每 5 分鐘一格',
      });
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

  it('報到時自動配發目前可用的實體號碼牌', async () => {
    const originalFindById = Appointment.findById;
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
    const queue = captureQueueWrites();
    // 1 號已歸還、2 號仍在使用；1 號今天不能重發，所以新報到要拿 3 號。
    Appointment.find = () => stubQueue([
      { _id: 'a', checkinNumber: null, checkinNumberHistory: [1] },
      { _id: 'b', checkinNumber: 2, checkinNumberHistory: [2] },
    ]);
    try {
      const beforeCheckin = Date.now();
      const response = await fetch(`${origin}/api/appointments/apt-checkin-time/check-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // 初次牌號由後端配發，body 偷帶號碼不影響。
        body: JSON.stringify({ checkinNumber: 1 }),
      });
      assert.equal(response.status, 200);
      assert.equal(appointment.status, 'arrived');
      assert.equal(appointment.visitType, 'return');
      assert.equal(appointment.checkinNumber, 3);
      assert.deepEqual(appointment.checkinNumberHistory, [3]);
      // 實體牌號只寫在剛報到的人身上，不重編前面兩人的牌。
      assert.equal(queue.phases, 0);
      assert.ok(appointment.checkedInAt instanceof Date);
      assert.ok(appointment.checkedInAt.getTime() >= beforeCheckin);
    } finally {
      Appointment.findById = originalFindById;
      queue.restore();
    }
  });

  it('可修改已報到掛號的實體號碼牌，不改動其他人的牌號', async () => {
    const originalFindById = Appointment.findById;
    const appointment = {
      _id: 'b',
      status: 'arrived',
      date: '2026-08-26',
      checkinNumber: 2,
      save: async () => {},
    };
    Appointment.findById = async () => appointment;
    const queue = captureQueueWrites();
    Appointment.find = () => stubQueue([
      { _id: 'a', checkinNumber: 1 },
      appointment,
      { _id: 'c', checkinNumber: null, checkinNumberHistory: [3] },
    ]);
    try {
      const response = await fetch(`${origin}/api/appointments/b/check-in-number`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ checkinNumber: 7 }),
      });
      assert.equal(response.status, 200);
      assert.equal(appointment.checkinNumber, 7);
      assert.deepEqual(appointment.checkinNumberHistory, [2, 7]);
      assert.equal(queue.phases, 0);
    } finally {
      Appointment.findById = originalFindById;
      queue.restore();
    }
  });

  it('不能把仍有人持有的實體號碼牌發給另一位候診者', async () => {
    const originalFindById = Appointment.findById;
    const appointment = { _id: 'b', status: 'arrived', date: '2026-08-26', checkinNumber: 2 };
    Appointment.findById = async () => appointment;
    const queue = captureQueueWrites();
    Appointment.find = () => stubQueue([
      { _id: 'a', checkinNumber: 1 },
      appointment,
      { _id: 'c', checkinNumber: 3 },
    ]);
    try {
      const response = await fetch(`${origin}/api/appointments/b/check-in-number`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ checkinNumber: 3 }),
      });
      assert.equal(response.status, 409);
      assert.equal(queue.phases, 0);
    } finally {
      Appointment.findById = originalFindById;
      queue.restore();
    }
  });

  it('完成看診後歸還自己的實體號碼牌，其他人的牌號不變', async () => {
    const originalFindById = Appointment.findById;
    const appointment = {
      _id: 'apt-done',
      status: 'arrived',
      date: '2026-08-26',
      checkinNumber: 1,
      save: async () => {},
    };
    Appointment.findById = () => ({
      session: async () => appointment,
      then: (resolve, reject) => Promise.resolve(appointment).then(resolve, reject),
    });
    const queue = captureQueueWrites();
    const others = [{ _id: 'b', checkinNumber: 2 }, { _id: 'c', checkinNumber: 3 }];
    Appointment.find = () => stubQueue(others);
    try {
      const response = await fetch(`${origin}/api/appointments/apt-done/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ followUpDate: '2026-09-08' }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(appointment.status, 'completed');
      assert.equal(appointment.followUpDate, '2026-09-08');
      assert.equal(body.record.followUpDate, '2026-09-08T02:00:00.000Z');
      assert.equal(appointment.checkinNumber, null);
      assert.deepEqual(appointment.checkinNumberHistory, [1]);
      assert.deepEqual(others.map((item) => item.checkinNumber), [2, 3]);
      assert.equal(queue.phases, 0);
    } finally {
      Appointment.findById = originalFindById;
      queue.restore();
    }
  });

  it('修正看診資料時，掛號與草稿病歷使用同一個 transaction', async () => {
    const originalAppointmentFindById = Appointment.findById;
    const originalRecordFindById = MedicalRecord.findById;
    const saves = [];
    const appointment = {
      _id: 'apt-visit-data',
      status: 'completed',
      recordId: 'record-visit-data',
      weightKg: 3,
      temperatureC: 38,
      followUpDate: '2026-09-15',
      visitNote: '原始備註',
      save: async (options) => { saves.push(['appointment', options]); },
    };
    const record = {
      _id: 'record-visit-data',
      status: 'draft',
      weightKg: 3,
      temperatureC: 38,
      followUpDate: new Date('2026-09-15T02:00:00.000Z'),
      other: '原始備註',
      save: async (options) => { saves.push(['record', options]); },
    };
    Appointment.findById = () => ({ session: async () => appointment });
    MedicalRecord.findById = () => ({ session: async () => record });
    const queue = captureQueueWrites();
    try {
      const response = await fetch(`${origin}/api/appointments/apt-visit-data/visit-data`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ weightKg: 4.2, temperatureC: 39.1, followUpDate: '2026-09-22', visitNote: '更新備註' }),
      });

      assert.equal(response.status, 200);
      assert.equal(appointment.weightKg, 4.2);
      assert.equal(record.weightKg, 4.2);
      assert.equal(record.temperatureC, 39.1);
      assert.equal(appointment.followUpDate, '2026-09-22');
      assert.equal(record.followUpDate.toISOString(), '2026-09-22T02:00:00.000Z');
      assert.equal(record.other, '更新備註');
      assert.equal(saves.length, 2);
      assert.ok(saves.every(([, options]) => options?.session));
    } finally {
      Appointment.findById = originalAppointmentFindById;
      MedicalRecord.findById = originalRecordFindById;
      queue.restore();
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

  it('已報到掛號可取消報到並歸還號碼牌，不改動其他人的牌號', async () => {
    const originalFindById = Appointment.findById;
    const appointment = {
      _id: 'apt-arrived-restore',
      status: 'arrived',
      date: '2026-08-26',
      checkinNumber: 3,
      checkedInAt: new Date('2026-08-26T02:15:00.000Z'),
      cancelReason: '',
      save: async () => {},
    };
    Appointment.findById = async () => appointment;
    const queue = captureQueueWrites();
    Appointment.find = () => stubQueue([{ _id: 'a', checkinNumber: 1 }, { _id: 'b', checkinNumber: 2 }]);
    try {
      const response = await fetch(`${origin}/api/appointments/apt-arrived-restore/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(response.status, 200);
      assert.equal(appointment.status, 'scheduled');
      assert.equal(appointment.checkinNumber, null);
      assert.deepEqual(appointment.checkinNumberHistory, [3]);
      assert.equal(appointment.checkedInAt, null);
      assert.equal(queue.phases, 0);
    } finally {
      Appointment.findById = originalFindById;
      queue.restore();
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

describe('appointments summary', () => {
  it('enumerateDates 產生日期陣列', () => {
    const dates = enumerateDates('2026-08-26', '2026-08-28');
    assert.deepEqual(dates, ['2026-08-26', '2026-08-27', '2026-08-28']);
  });

  it('fillDailyCounts 補零並排序', () => {
    const dates = ['2026-08-26', '2026-08-27', '2026-08-28'];
    const buckets = [{ _id: '2026-08-27', count: 3 }];
    const result = fillDailyCounts(dates, buckets);
    assert.deepEqual(result, [
      { date: '2026-08-26', count: 0 },
      { date: '2026-08-27', count: 3 },
      { date: '2026-08-28', count: 0 },
    ]);
  });

  describe('GET /appointments/summary', () => {
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

    it('需要 start 與 end 參數', async () => {
      const response = await fetch(`${origin}/api/appointments/summary`);
      assert.equal(response.status, 422);
      assert.match((await response.json()).message, /日期/);
    });

    it('格式不正確回 422', async () => {
      const response = await fetch(`${origin}/api/appointments/summary?start=2026/08/26&end=2026/08/28`);
      assert.equal(response.status, 422);
      assert.match((await response.json()).message, /日期/);
    });

    it('start > end 回 422', async () => {
      const response = await fetch(`${origin}/api/appointments/summary?start=2026-08-28&end=2026-08-26`);
      assert.equal(response.status, 422);
      assert.match((await response.json()).message, /不可晚於/);
    });

    it('超過 31 天回 422', async () => {
      const response = await fetch(`${origin}/api/appointments/summary?start=2026-08-01&end=2026-09-02`);
      assert.equal(response.status, 422);
      assert.match((await response.json()).message, /最多 31 天/);
    });

    it('正常查詢回傳每日計數', async () => {
      const originalAggregate = Appointment.aggregate;
      Appointment.aggregate = async () => [{ _id: '2026-08-27', count: 3 }];
      try {
        const response = await fetch(`${origin}/api/appointments/summary?start=2026-08-26&end=2026-08-28`);
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.deepEqual(body.items, [
          { date: '2026-08-26', count: 0 },
          { date: '2026-08-27', count: 3 },
          { date: '2026-08-28', count: 0 },
        ]);
      } finally {
        Appointment.aggregate = originalAggregate;
      }
    });
  });
});
