import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { activeMentionQuery, insertMention, mentionsStillInContent, splitMentionSegments } from './chatMentions.js';

describe('chat mentions', () => {
  it('偵測游標前正在打的 @關鍵字', () => {
    assert.deepEqual(activeMentionQuery('@豆', 2), { start: 0, query: '豆' });
    assert.deepEqual(activeMentionQuery('問一下 @', 5), { start: 4, query: '' });
    assert.equal(activeMentionQuery('a@b.com', 7), null);
    assert.equal(activeMentionQuery('@豆豆 已經打完', 9), null);
  });

  it('插入標記後游標停在名字後面的空白之後', () => {
    assert.deepEqual(insertMention('問 @豆 吃藥', 2, 4, '豆豆'), { text: '問 @豆豆  吃藥', caret: 6 });
  });

  it('送出時丟掉內文已經刪掉的標記，並去除重複', () => {
    const mentions = [{ petId: '1', petName: '豆豆' }, { petId: '2', petName: '咪咪' }, { petId: '1', petName: '豆豆' }];
    assert.deepEqual(mentionsStillInContent('@豆豆 要回診嗎', mentions), [{ petId: '1', petName: '豆豆' }]);
  });

  it('拆出標記段，長名字優先比對', () => {
    const mentions = [{ petId: '1', petName: '豆豆' }, { petId: '2', petName: '豆豆二號' }];
    const segments = splitMentionSegments('看 @豆豆二號 跟 @豆豆', mentions);
    assert.deepEqual(segments.map((s) => (s.type === 'text' ? s.text : `[${s.mention.petId}]`)), ['看 ', '[2]', ' 跟 ', '[1]']);
    assert.deepEqual(splitMentionSegments('沒有標記', undefined), [{ type: 'text', text: '沒有標記' }]);
  });
});
