import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDepositDecision, checkDepositEdit, depositCauseText, depositRequired } from '../../../shared/deposit.js';

test('checkDepositEdit：可以清空、改已收或已退還；不收要原因；沿用不能手動選', () => {
  assert.deepEqual(checkDepositEdit({ status: '' }), { status: '', reason: '' });
  assert.deepEqual(checkDepositEdit({ status: 'collected', reason: '多餘' }), { status: 'collected', reason: '' });
  assert.deepEqual(checkDepositEdit({ status: 'refunded' }), { status: 'refunded', reason: '' });
  assert.deepEqual(checkDepositEdit({ status: 'waived', reason: ' 醫師同意 ' }), { status: 'waived', reason: '醫師同意' });
  assert.ok(checkDepositEdit({ status: 'waived' }).error);
  assert.ok(checkDepositEdit({ status: 'carried' }).error);
  assert.ok(checkDepositEdit({ status: 'paid' }).error);
});

test('depositRequired：遲到兩次或未到一次', () => {
  assert.equal(depositRequired({ lateCount: 1, noShowCount: 0 }), false);
  assert.equal(depositRequired({ lateCount: 2, noShowCount: 0 }), true);
  assert.equal(depositRequired({ lateCount: 0, noShowCount: 1 }), true);
  assert.equal(depositRequired(null), false);
});

test('depositCauseText：只列達到門檻的項目', () => {
  assert.equal(depositCauseText({ lateCount: 2, noShowCount: 0 }), '遲到 2 次');
  assert.equal(depositCauseText({ lateCount: 1, noShowCount: 1 }), '未到 1 次');
  assert.equal(depositCauseText({ lateCount: 3, noShowCount: 2 }), '遲到 3 次、未到 2 次');
});

test('checkDepositDecision：不需要收時不採信呼叫端的狀態', () => {
  assert.deepEqual(checkDepositDecision({ status: 'collected' }, false), { status: '', reason: '' });
});

test('checkDepositDecision：需要收時一定要決定，不收要有原因', () => {
  assert.ok(checkDepositDecision(undefined, true).error);
  assert.ok(checkDepositDecision({ status: 'waived', reason: '  ' }, true).error);
  assert.ok(checkDepositDecision({ status: 'waived', reason: '字'.repeat(201) }, true).error);
  assert.deepEqual(checkDepositDecision({ status: 'collected', reason: '多餘' }, true), { status: 'collected', reason: '' });
  assert.deepEqual(checkDepositDecision({ status: 'waived', reason: ' 老客人，醫師同意 ' }, true), { status: 'waived', reason: '老客人，醫師同意' });
});
