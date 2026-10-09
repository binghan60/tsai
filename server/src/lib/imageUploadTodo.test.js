import test from 'node:test';
import assert from 'node:assert/strict';
import Todo from '../models/Todo.js';
import { imageUploadTodoContent, restoreImageUploadTodo, withdrawImageUploadTodo } from './imageUploadTodo.js';

// 看診離開流程時只收掉還沒做的那筆待辦；已完成的留著、關聯也留著。
test('withdrawImageUploadTodo removes only an open todo', async () => {
  const original = Todo.deleteOne;
  const filters = [];
  let deletedCount = 1;
  Todo.deleteOne = (filter) => { filters.push(filter); return { session: async () => ({ deletedCount }) }; };
  try {
    const open = { imageUpload: true, imageUploadTodoId: 't1' };
    assert.equal(await withdrawImageUploadTodo(open), true);
    assert.deepEqual(filters[0], { _id: 't1', status: 'open' });
    assert.equal(open.imageUploadTodoId, null);
    assert.equal(open.imageUpload, true);

    deletedCount = 0;
    const done = { imageUpload: true, imageUploadTodoId: 't2' };
    assert.equal(await withdrawImageUploadTodo(done), false);
    assert.equal(done.imageUploadTodoId, 't2');

    assert.equal(await withdrawImageUploadTodo({ imageUpload: null, imageUploadTodoId: null }), false);
    assert.equal(filters.length, 2);
  } finally {
    Todo.deleteOne = original;
  }
});

// 重新報到：沒勾、或待辦還在（已完成的那筆）就不補。
test('restoreImageUploadTodo does nothing unless ticked and the todo was withdrawn', async () => {
  assert.equal(await restoreImageUploadTodo({ imageUpload: null, imageUploadTodoId: null }), false);
  assert.equal(await restoreImageUploadTodo({ imageUpload: false, imageUploadTodoId: null }), false);
  assert.equal(await restoreImageUploadTodo({ imageUpload: true, imageUploadTodoId: 't2' }), false);
});

test('the todo names the cat with a # mention, escaping markup characters in the name', () => {
  assert.equal(imageUploadTodoContent('豆豆'), '上傳影像 #豆豆');
  assert.equal(imageUploadTodoContent('*星星*'), String.raw`上傳影像 #\*星星\*`);
  assert.equal(imageUploadTodoContent(''), '上傳影像');
});
