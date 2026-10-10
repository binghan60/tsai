import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkinTone, latenessLabel, patientNotesFor } from './appointmentDisplay.js';

describe('patientNotesFor', () => {
  const notes = { pets: { p1: '會咬人' }, owners: { o1: '處置前先說明費用' } };
  it('貓咪在前、飼主在後，只回有內容的', () => {
    assert.deepEqual(
      patientNotesFor({ petId: 'p1', ownerId: 'o1' }, notes).map((note) => note.label),
      ['貓咪', '飼主'],
    );
    assert.deepEqual(patientNotesFor({ petId: 'p2', ownerId: 'o1' }, notes).map((note) => note.text), ['處置前先說明費用']);
  });
  it('初診尚未建檔或沒有資料時回空陣列', () => {
    assert.deepEqual(patientNotesFor({ petId: null, ownerId: null }, notes), []);
    assert.deepEqual(patientNotesFor({ petId: 'p1' }), []);
  });
});

describe('latenessLabel', () => {
  it('不足一分鐘不算遲到', () => {
    assert.equal(latenessLabel(0), '');
    assert.equal(latenessLabel(0.9), '');
    assert.equal(latenessLabel(null), '');
  });
  it('分鐘數取整數', () => {
    assert.equal(latenessLabel(25), '遲到 25 分');
    assert.equal(latenessLabel(12.7), '遲到 12 分');
  });
});

describe('checkinTone', () => {
  const base = { status: 'arrived' };
  it('依三個里程碑決定階段', () => {
    assert.equal(checkinTone(base), 'waiting');
    assert.equal(checkinTone({ ...base, visitStartedAt: '2026-09-17T02:00:00Z' }), 'visiting');
    assert.equal(checkinTone({ ...base, visitStartedAt: '2026-09-17T02:00:00Z', handoffAt: '2026-09-17T02:10:00Z' }), 'handoff');
    assert.equal(checkinTone({ ...base, handoffAt: '2026-09-17T02:10:00Z', deskCompletedAt: '2026-09-17T02:20:00Z' }), 'done');
  });
});
