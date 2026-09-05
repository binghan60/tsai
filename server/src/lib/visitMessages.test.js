import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatVisitMessagesTranscript } from './visitMessages.js';

describe('formatVisitMessagesTranscript', () => {
  it('空陣列或缺值回傳空字串', () => {
    assert.equal(formatVisitMessagesTranscript([]), '');
    assert.equal(formatVisitMessagesTranscript(undefined), '');
    assert.equal(formatVisitMessagesTranscript(null), '');
  });

  it('依身分標籤與時間組成逐行記錄，保留原始順序', () => {
    const transcript = formatVisitMessagesTranscript([
      { sender: 'vet', content: '免掛號費', createdAt: '2026-08-26T06:32:00.000Z' },
      { sender: 'front_desk', content: '已處理', createdAt: '2026-08-26T06:35:00.000Z' },
    ]);
    assert.equal(transcript, '[14:32 醫生] 免掛號費\n[14:35 櫃台] 已處理');
  });

  it('未知的 sender 直接原樣顯示，不會拋錯', () => {
    const transcript = formatVisitMessagesTranscript([
      { sender: 'someone', content: '測試', createdAt: '2026-08-26T06:00:00.000Z' },
    ]);
    assert.equal(transcript, '[14:00 someone] 測試');
  });
});
