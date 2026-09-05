import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeVisitMessage, visitMessageSenderLabel } from './visitMessageThread.js';

describe('mergeVisitMessage', () => {
  it('沒有重複時附加到陣列尾端', () => {
    const messages = [{ _id: 'm1', content: '第一則' }];
    const result = mergeVisitMessage(messages, { _id: 'm2', content: '第二則' });
    assert.deepEqual(result.map((m) => m._id), ['m1', 'm2']);
  });

  it('相同 _id 已存在時不重複插入（POST 回應與 socket 廣播可能重複到達）', () => {
    const messages = [{ _id: 'm1', content: '第一則' }];
    const result = mergeVisitMessage(messages, { _id: 'm1', content: '第一則' });
    assert.equal(result, messages);
  });

  it('缺少留言時原樣回傳', () => {
    const messages = [{ _id: 'm1', content: '第一則' }];
    assert.equal(mergeVisitMessage(messages, null), messages);
  });
});

describe('visitMessageSenderLabel', () => {
  it('對應身分標籤', () => {
    assert.equal(visitMessageSenderLabel('vet'), '醫生');
    assert.equal(visitMessageSenderLabel('front_desk'), '櫃台');
  });
});
