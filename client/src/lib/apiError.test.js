import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiErrorMessage } from './apiError.js';

test('apiErrorMessage 優先用後端給的說明', () => {
  assert.equal(apiErrorMessage({ response: { data: { message: '時段已過' } } }, '儲存失敗'), '時段已過');
});

test('apiErrorMessage 沒有回應或說明是空的就用後備文字', () => {
  assert.equal(apiErrorMessage(new Error('Network Error'), '儲存失敗'), '儲存失敗');
  assert.equal(apiErrorMessage({ response: { data: { message: '' } } }, '儲存失敗'), '儲存失敗');
  assert.equal(apiErrorMessage(undefined, '儲存失敗'), '儲存失敗');
});
