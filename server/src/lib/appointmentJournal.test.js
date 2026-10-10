import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visitHasJournal } from './appointmentJournal.js';

const visit = (extra) => ({ petId: 'pet-1', status: 'arrived', reason: '咳嗽', ...extra });

test('取消、取消報到、未到的看診沒有成立，不留日誌', () => {
  for (const status of ['scheduled', 'cancelled', 'no_show']) {
    assert.equal(visitHasJournal(visit({ status, visitNote: '寫過的紀錄', visitStartedAt: new Date() })), false, status);
  }
});

test('只有來院原因時，要醫師開始看診才算內容', () => {
  assert.equal(visitHasJournal(visit()), false, '剛報到、還在候診');
  assert.equal(visitHasJournal(visit({ visitStartedAt: new Date() })), true);
  assert.equal(visitHasJournal(visit({ status: 'pending_checkout', handoffAt: new Date() })), true);
});

test('有紀錄、量測或藥單就有日誌，不論有沒有開始看診', () => {
  assert.equal(visitHasJournal(visit({ visitNote: '安排檢查' })), true);
  assert.equal(visitHasJournal(visit({ weightKg: 4.2 })), true);
  assert.equal(visitHasJournal(visit({ prescription: 'Amoxicillin 5 天' })), true);
});

test('沒有建檔的貓、或什麼內容都沒有，就沒有日誌', () => {
  assert.equal(visitHasJournal(visit({ petId: null, visitNote: '紀錄' })), false);
  assert.equal(visitHasJournal({ petId: 'pet-1', status: 'completed', deskCompletedAt: new Date() }), false);
});
