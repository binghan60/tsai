import test from 'node:test';
import assert from 'node:assert/strict';
import { imageUploadTodoContent } from './imageUploadTodo.js';

test('the todo names the cat with a # mention, escaping markup characters in the name', () => {
  assert.equal(imageUploadTodoContent('豆豆'), '上傳影像 #豆豆');
  assert.equal(imageUploadTodoContent('*星星*'), String.raw`上傳影像 #\*星星\*`);
  assert.equal(imageUploadTodoContent(''), '上傳影像');
});
