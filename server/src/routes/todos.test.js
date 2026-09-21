import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { app } from '../app.js';
import Pet from '../models/Pet.js';
import Todo from '../models/Todo.js';
import { isValidDateInput, sortOpenTodos } from '../lib/todos.js';

const todoId = '64b000000000000000000010';
const petId = '64b000000000000000000001';
const jsonHeaders = { 'content-type': 'application/json' };

function mockList(open = [], done = []) {
  Todo.find = (filter) => ({
    sort: () => ({ limit: () => ({ lean: async () => (filter.status === 'open' ? open : done) }) }),
  });
}

// 寵物名字快照走 Pet.find(...).select().populate().lean()，跟聊天室的 # 標記同一條路徑。
function mockPets(pets) {
  Pet.find = () => ({ select: () => ({ populate: () => ({ lean: async () => pets }) }) });
}

// 模擬 Mongoose document：save 只記錄被呼叫，欄位直接寫在物件上。
function mockTodoDoc(fields) {
  const doc = { ...fields, saved: 0, async save() { doc.saved += 1; } };
  Todo.findById = async () => doc;
  return doc;
}

describe('todo lib', () => {
  it('未完成清單：有期限的在前且由早到晚，沒期限的照建立順序接後面', () => {
    const rows = [
      { _id: 'a', dueDate: null, createdAt: '2026-09-01T00:00:00Z' },
      { _id: 'b', dueDate: '2026-09-30', createdAt: '2026-09-03T00:00:00Z' },
      { _id: 'c', dueDate: null, createdAt: '2026-08-01T00:00:00Z' },
      { _id: 'd', dueDate: '2026-09-10', createdAt: '2026-09-05T00:00:00Z' },
      { _id: 'e', dueDate: '2026-09-10', createdAt: '2026-09-02T00:00:00Z' },
    ];
    assert.deepEqual(sortOpenTodos(rows).map((row) => row._id), ['e', 'd', 'b', 'c', 'a']);
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
    assert.deepEqual((await response.json()).items.map((item) => item._id), ['o2', 'o1', 'd1']);
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

  it('完成是冪等的：已完成的不會被覆寫完成時間', async () => {
    const doc = mockTodoDoc({ status: 'open', doneAt: null, doneBy: null });
    mockList();
    assert.equal((await post(`/${todoId}/complete`, { doneBy: 'front_desk' })).status, 200);
    assert.equal(doc.status, 'done');
    assert.equal(doc.doneBy, 'front_desk');
    const firstDoneAt = doc.doneAt;
    assert.ok(firstDoneAt instanceof Date);

    assert.equal((await post(`/${todoId}/complete`, { doneBy: 'vet' })).status, 200);
    assert.equal(doc.doneBy, 'front_desk');
    assert.equal(doc.doneAt, firstDoneAt);
    assert.equal(doc.saved, 1);
  });

  it('完成要帶合法身分；重開會清掉完成資訊，已是未完成則不動', async () => {
    mockTodoDoc({ status: 'open' });
    assert.equal((await post(`/${todoId}/complete`, { doneBy: 'someone' })).status, 422);

    const done = mockTodoDoc({ status: 'done', doneAt: new Date(), doneBy: 'vet' });
    mockList();
    assert.equal((await post(`/${todoId}/reopen`, {})).status, 200);
    assert.equal(done.status, 'open');
    assert.equal(done.doneAt, null);
    assert.equal(done.doneBy, null);

    const open = mockTodoDoc({ status: 'open' });
    assert.equal((await post(`/${todoId}/reopen`, {})).status, 200);
    assert.equal(open.saved, 0);
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
