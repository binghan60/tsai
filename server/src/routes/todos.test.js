import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import mongoose from 'mongoose';
import { app } from '../app.js';
import Pet from '../models/Pet.js';
import Todo from '../models/Todo.js';
import Appointment from '../models/Appointment.js';
import Owner from '../models/Owner.js';
import { isValidDateInput, sortOpenTodos } from '../lib/todos.js';

const todoId = '64b000000000000000000010';
const petId = '64b000000000000000000001';
const jsonHeaders = { 'content-type': 'application/json' };

// 清單查詢走 find().sort().limit()[.select().session()].lean()（拖拉排序在 transaction 裡讀同一份清單）。
// links：掛號「上傳影像」帶出待辦的連結，listTodos 會由此查到飼主 Email（預設沒有）。
function mockList(open = [], done = [], links = { appointments: [], owners: [] }) {
  const chain = (rows) => { const query = { lean: async () => rows }; query.select = () => query; return query; };
  Appointment.find = () => chain(links.appointments);
  Owner.find = () => chain(links.owners);
  Todo.find = (filter) => {
    const query = { lean: async () => (filter.status === 'open' ? open : done) };
    query.select = () => query;
    query.session = () => query;
    return { sort: () => ({ limit: () => query }) };
  };
}

// 貓咪名字快照走 Pet.find(...).select().populate().lean()，跟聊天室的 # 標記同一條路徑。
function mockPets(pets) {
  Pet.find = () => ({ select: () => ({ populate: () => ({ lean: async () => pets }) }) });
}

// 完成／改回未完成會反查「上傳影像」帶出這筆待辦的掛號；記下寫回了什麼，預設查不到掛號。
const imageUploadWrites = [];
Appointment.findOneAndUpdate = async (filter, update) => { imageUploadWrites.push(update.$set.imageUploadDoneAt); return null; };

// 模擬 Mongoose document：save 只記錄被呼叫，欄位直接寫在物件上。
function mockTodoDoc(fields) {
  const doc = { ...fields, saved: 0, async save() { doc.saved += 1; } };
  Todo.findById = async () => doc;
  return doc;
}

describe('todo lib', () => {
  it('未完成清單完全照手動順序：星號與期限不影響位置', () => {
    const rows = [
      { _id: 'a', sortOrder: 2, starred: true, dueDate: '2026-09-01', createdAt: '2026-09-01T00:00:00Z' },
      { _id: 'b', sortOrder: 0, dueDate: null, createdAt: '2026-09-03T00:00:00Z' },
      { _id: 'c', sortOrder: 1, dueDate: '2026-09-30', createdAt: '2026-08-01T00:00:00Z' },
    ];
    assert.deepEqual(sortOpenTodos(rows).map((row) => row._id), ['b', 'c', 'a']);
  });

  it('沒有 sortOrder 的舊資料以建立時間代替，排在拖拉編號過的後面', () => {
    const rows = [
      { _id: 'old2', createdAt: '2026-09-02T00:00:00Z' },
      { _id: 'old1', createdAt: '2026-09-01T00:00:00Z' },
      { _id: 'moved', sortOrder: 0, createdAt: '2026-09-05T00:00:00Z' },
    ];
    assert.deepEqual(sortOpenTodos(rows).map((row) => row._id), ['moved', 'old1', 'old2']);
  });

  it('sortOrder 沒有 default：舊待辦被讀出來改別的欄位，不會被寫入順序而跳到最下面', () => {
    const doc = Todo.hydrate({ _id: todoId, content: '舊待辦', createdBy: 'vet', status: 'open', createdAt: new Date('2026-01-01') });
    doc.starred = true;
    assert.equal(doc.getChanges().$set.sortOrder, undefined);
  });

  it('日期驗證只接受真實存在的日曆日', () => {
    assert.equal(isValidDateInput('2026-09-22'), true);
    assert.equal(isValidDateInput('2026-02-31'), false);
    assert.equal(isValidDateInput('2026-9-2'), false);
    assert.equal(isValidDateInput('明天'), false);
  });
});

describe('todos routes', () => {
  let server;
  let origin;
  const original = { find: Todo.find, create: Todo.create, findById: Todo.findById, deleteOne: Todo.deleteOne, petFind: Pet.find };

  before(async () => {
    server = app.listen(0, '127.0.0.1');
    if (!server.listening) await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    Object.assign(Todo, { find: original.find, create: original.create, findById: original.findById, deleteOne: original.deleteOne });
    Pet.find = original.petFind;
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  const post = (path, body) => fetch(`${origin}/api/todos${path}`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) });
  const put = (path, body) => fetch(`${origin}/api/todos${path}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body) });

  it('GET 未完成排前面、最近完成接在後面', async () => {
    mockList(
      [{ _id: 'o1', status: 'open', dueDate: null, createdAt: '2026-09-01T00:00:00Z' }, { _id: 'o2', status: 'open', dueDate: '2026-09-20', createdAt: '2026-09-02T00:00:00Z' }],
      [{ _id: 'd1', status: 'done' }]
    );
    const response = await fetch(`${origin}/api/todos`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).items.map((item) => item._id), ['o1', 'o2', 'd1']);
  });

  it('GET 上傳影像待辦附飼主 Email（即時查，沒有 Email 或沒連到掛號的不帶）', async () => {
    const owner = '64b0000000000000000000b1';
    const noEmailOwner = '64b0000000000000000000b2';
    mockList(
      [
        { _id: 'u1', status: 'open', content: '上傳影像', createdAt: '2026-09-01T00:00:00Z' },
        { _id: 'u2', status: 'open', content: '上傳影像', createdAt: '2026-09-02T00:00:00Z' },
        { _id: 'u3', status: 'open', content: '叫貨', createdAt: '2026-09-03T00:00:00Z' },
      ],
      [],
      {
        appointments: [{ imageUploadTodoId: 'u1', ownerId: owner }, { imageUploadTodoId: 'u2', ownerId: noEmailOwner }],
        owners: [{ _id: owner, email: 'wang@example.com' }, { _id: noEmailOwner }],
      }
    );
    const items = (await (await fetch(`${origin}/api/todos`)).json()).items;
    assert.equal(items.find((item) => item._id === 'u1').ownerEmail, 'wang@example.com');
    assert.equal('ownerEmail' in items.find((item) => item._id === 'u2'), false);
    assert.equal('ownerEmail' in items.find((item) => item._id === 'u3'), false);
  });

  it('POST 建立待辦：內容去空白、# 標記的名字快照由伺服器查、重複的 id 只算一次', async () => {
    let created;
    Todo.create = async (doc) => { created = doc; return doc; };
    mockPets([{ _id: petId, name: '豆豆', ownerId: { name: '王小明' } }]);
    mockList();
    const response = await post('', {
      content: '  #假名字 回電給王小姐  ', createdBy: 'front_desk', dueDate: '2026-09-25',
      mentions: [petId, petId], petName: '偽造的名字',
    });
    assert.equal(response.status, 201);
    assert.equal(created.content, '#假名字 回電給王小姐');
    assert.equal(created.dueDate, '2026-09-25');
    assert.deepEqual(created.mentions, [{ petId, petName: '豆豆', ownerName: '王小明' }]);
  });

  it('POST 不帶標記與期限也能建立', async () => {
    let created;
    Todo.create = async (doc) => { created = doc; return doc; };
    mockList();
    const response = await post('', { content: '明天叫貨', createdBy: 'vet' });
    assert.equal(response.status, 201);
    assert.equal(created.dueDate, null);
    assert.deepEqual(created.mentions, []);
  });

  it('POST 擋掉不合法的輸入', async () => {
    let called = false;
    Todo.create = async () => { called = true; };
    assert.equal((await post('', { content: '要做的事', createdBy: 'someone' })).status, 422);
    assert.equal((await post('', { content: '   ', createdBy: 'vet' })).status, 422);
    assert.equal((await post('', { content: 'x'.repeat(501), createdBy: 'vet' })).status, 422);
    assert.equal((await post('', { content: '要做的事', createdBy: 'vet', dueDate: '2026-02-31' })).status, 422);
    assert.equal((await post('', { content: '要做的事', createdBy: 'vet', mentions: ['not-an-id'] })).status, 422);
    assert.equal((await post('', { content: '要做的事', createdBy: 'vet', mentions: petId })).status, 422);
    const tooMany = Array.from({ length: 6 }, (_, i) => `64b00000000000000000010${i}`);
    assert.equal((await post('', { content: '要做的事', createdBy: 'vet', mentions: tooMany })).status, 422);
    mockPets([]);
    assert.equal((await post('', { content: '要做的事', createdBy: 'vet', mentions: [petId] })).status, 422);
    assert.equal(called, false);
  });

  it('PUT 只改有帶的欄位；mentions 帶了就整組取代，帶空陣列＝全部拿掉', async () => {
    const doc = mockTodoDoc({ content: '舊內容', dueDate: '2026-09-25', mentions: [{ petId, petName: '豆豆', ownerName: '王小明' }] });
    mockList();
    assert.equal((await put(`/${todoId}`, { content: '新內容' })).status, 200);
    assert.equal(doc.content, '新內容');
    assert.equal(doc.dueDate, '2026-09-25');
    assert.equal(doc.mentions.length, 1);

    assert.equal((await put(`/${todoId}`, { mentions: [] })).status, 200);
    assert.deepEqual(doc.mentions, []);

    mockPets([{ _id: petId, name: '咪咪', ownerId: null }]);
    assert.equal((await put(`/${todoId}`, { mentions: [petId] })).status, 200);
    assert.deepEqual(doc.mentions, [{ petId, petName: '咪咪', ownerName: '' }]);
    assert.equal(doc.saved, 3);
  });

  it('PUT dueDate 帶空字串代表清掉期限；找不到回 404', async () => {
    const doc = mockTodoDoc({ content: '內容', dueDate: '2026-09-25' });
    mockList();
    assert.equal((await put(`/${todoId}`, { dueDate: '' })).status, 200);
    assert.equal(doc.dueDate, null);
    Todo.findById = async () => null;
    assert.equal((await put(`/${todoId}`, { content: '內容' })).status, 404);
  });

  it('PUT starred 標上／拿掉星號，不動其他欄位；不是布林回 422', async () => {
    const doc = mockTodoDoc({ content: '內容', dueDate: '2026-09-25', starred: false });
    mockList();
    assert.equal((await put(`/${todoId}`, { starred: true })).status, 200);
    assert.equal(doc.starred, true);
    assert.equal(doc.content, '內容');
    assert.equal(doc.dueDate, '2026-09-25');
    assert.equal((await put(`/${todoId}`, { starred: false })).status, 200);
    assert.equal(doc.starred, false);
    assert.equal((await put(`/${todoId}`, { starred: 'yes' })).status, 422);
    assert.equal(doc.saved, 2);
  });

  it('完成是冪等的：已完成的不會被覆寫完成時間', async () => {
    const doc = mockTodoDoc({ status: 'open', doneAt: null, doneBy: null });
    mockList();
    imageUploadWrites.length = 0;
    assert.equal((await post(`/${todoId}/complete`, { doneBy: 'front_desk' })).status, 200);
    assert.equal(doc.status, 'done');
    assert.equal(doc.doneBy, 'front_desk');
    const firstDoneAt = doc.doneAt;
    assert.ok(firstDoneAt instanceof Date);

    assert.equal((await post(`/${todoId}/complete`, { doneBy: 'vet' })).status, 200);
    assert.equal(doc.doneBy, 'front_desk');
    assert.equal(doc.doneAt, firstDoneAt);
    assert.equal(doc.saved, 1);
    // 完成時間寫回「上傳影像」的掛號，只在真的完成的那一次。
    assert.deepEqual(imageUploadWrites, [firstDoneAt]);
  });

  it('完成要帶合法身分；重開會清掉完成資訊，已是未完成則不動', async () => {
    mockTodoDoc({ status: 'open' });
    assert.equal((await post(`/${todoId}/complete`, { doneBy: 'someone' })).status, 422);

    const done = mockTodoDoc({ status: 'done', doneAt: new Date(), doneBy: 'vet' });
    mockList();
    imageUploadWrites.length = 0;
    assert.equal((await post(`/${todoId}/reopen`, {})).status, 200);
    assert.deepEqual(imageUploadWrites, [null]);
    assert.equal(done.status, 'open');
    assert.equal(done.doneAt, null);
    assert.equal(done.doneBy, null);
    // 改回未完成的排到最下面（sortOrder 換成當下時間）。
    assert.ok(done.sortOrder >= Date.now() - 60_000);

    const open = mockTodoDoc({ status: 'open' });
    assert.equal((await post(`/${todoId}/reopen`, {})).status, 200);
    assert.equal(open.saved, 0);
  });

  it('處理過程：PUT 帶 progress 寫入（多行、去頭尾空白、換行統一成 \\n），不動完成狀態；太長或不是字串回 422', async () => {
    const doc = mockTodoDoc({ status: 'open', content: '回電', progress: '' });
    mockList();
    assert.equal((await put(`/${todoId}`, { progress: '  10/12 沒接\r\n10/13 已回電  ' })).status, 200);
    assert.equal(doc.progress, '10/12 沒接\n10/13 已回電');
    assert.equal(doc.status, 'open');
    assert.equal(doc.content, '回電');

    assert.equal((await put(`/${todoId}`, { progress: '' })).status, 200);
    assert.equal(doc.progress, '');

    assert.equal((await put(`/${todoId}`, { progress: 'x'.repeat(501) })).status, 422);
    assert.equal((await put(`/${todoId}`, { progress: 3 })).status, 422);
  });

  it('處理過程：已完成的不能改（409），其他欄位照樣能改', async () => {
    const doc = mockTodoDoc({ status: 'done', content: '回電', progress: '10/13 已回電', starred: false });
    mockList();
    assert.equal((await put(`/${todoId}`, { progress: '偷改' })).status, 409);
    assert.equal(doc.progress, '10/13 已回電');
    assert.equal(doc.saved, 0);
    assert.equal((await put(`/${todoId}`, { starred: true })).status, 200);
    assert.equal(doc.starred, true);
  });

  it('GET /search 只查已完成、比對內文／處理過程／貓咪名字（關鍵字當字面字串）；沒關鍵字回空', async () => {
    let filter;
    Todo.find = (value) => { filter = value; return { sort: () => ({ limit: () => ({ lean: async () => [{ _id: 'd1', status: 'done' }] }) }) }; };
    const response = await fetch(`${origin}/api/todos/search?q=${encodeURIComponent('k/d (3')}`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).items.map((item) => item._id), ['d1']);
    assert.equal(filter.status, 'done');
    assert.deepEqual(filter.$or.map((part) => Object.keys(part)[0]), ['content', 'progress', 'mentions.petName']);
    assert.ok(filter.$or[0].content.test('叫貨 k/d (3 包'));

    filter = null;
    assert.deepEqual((await (await fetch(`${origin}/api/todos/search?q=%20`)).json()).items, []);
    assert.equal(filter, null);
  });

  describe('POST /:id/move 拖拉排序', () => {
    const ids = ['64b000000000000000000a01', '64b000000000000000000a02', '64b000000000000000000a03', '64b000000000000000000a04'];
    const writes = [];
    let originalBulkWrite;
    let originalStartSession;

    before(() => {
      originalBulkWrite = Todo.bulkWrite;
      originalStartSession = mongoose.startSession;
      Todo.bulkWrite = async (operations) => { writes.push(operations.map((op) => [op.updateOne.filter._id, op.updateOne.update.$set.sortOrder])); };
      mongoose.startSession = async () => ({ withTransaction: async (callback) => callback(), endSession: async () => {} });
    });
    after(() => {
      Todo.bulkWrite = originalBulkWrite;
      mongoose.startSession = originalStartSession;
    });

    // a01..a04 已依序編號 0..3。
    const openRows = () => ids.map((_id, index) => ({ _id, status: 'open', sortOrder: index, createdAt: '2026-09-01T00:00:00Z' }));

    it('移到某一筆前面：整份重新編號，只寫有變的', async () => {
      mockList(openRows());
      writes.length = 0;
      const response = await post(`/${ids[3]}/move`, { beforeId: ids[1] });
      assert.equal(response.status, 200);
      // 新順序 a01, a04, a02, a03
      assert.deepEqual(writes, [[[ids[3], 1], [ids[1], 2], [ids[2], 3]]]);
    });

    it('beforeId 為 null＝移到最後', async () => {
      mockList(openRows());
      writes.length = 0;
      assert.equal((await post(`/${ids[0]}/move`, { beforeId: null })).status, 200);
      assert.deepEqual(writes, [[[ids[1], 0], [ids[2], 1], [ids[3], 2], [ids[0], 3]]]);
    });

    it('位置沒變不寫資料庫', async () => {
      mockList(openRows());
      writes.length = 0;
      assert.equal((await post(`/${ids[1]}/move`, { beforeId: ids[2] })).status, 200);
      assert.deepEqual(writes, []);
    });

    it('要排的那筆或 beforeId 已經不在未完成清單上回 409（附最新清單），不寫資料庫', async () => {
      mockList(openRows().slice(0, 3));
      writes.length = 0;
      const gone = await post(`/${ids[3]}/move`, { beforeId: ids[0] });
      assert.equal(gone.status, 409);
      assert.equal((await gone.json()).items.length, 3);
      assert.equal((await post(`/${ids[0]}/move`, { beforeId: ids[3] })).status, 409);
      assert.deepEqual(writes, []);
    });

    it('參數不正確回 422', async () => {
      assert.equal((await post('/not-an-id/move', { beforeId: null })).status, 422);
      assert.equal((await post(`/${ids[0]}/move`, { beforeId: 'x' })).status, 422);
      assert.equal((await post(`/${ids[0]}/move`, { beforeId: ids[0] })).status, 422);
    });
  });

  it('DELETE 已經不存在也算成功', async () => {
    let filter;
    Todo.deleteOne = async (value) => { filter = value; return { deletedCount: 0 }; };
    mockList();
    const response = await fetch(`${origin}/api/todos/${todoId}`, { method: 'DELETE' });
    assert.equal(response.status, 200);
    assert.equal(filter._id, todoId);
    assert.deepEqual((await response.json()).items, []);
  });
});
