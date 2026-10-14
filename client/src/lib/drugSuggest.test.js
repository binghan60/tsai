import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { drugQueryAt, rankDrugs } from './drugSuggest.js';

describe('drugQueryAt', () => {
  it('取游標前從上一個空白或標點開始的那一段', () => {
    assert.deepEqual(drugQueryAt('Famotidine 1# BID\nmet'.split('\n').at(-1)), { start: 0, query: 'met' });
    assert.deepEqual(drugQueryAt('飯後 met'), { start: 3, query: 'met' });
    assert.deepEqual(drugQueryAt('止吐、胃'), { start: 3, query: '胃' });
  });

  it('開頭的編號不算進去', () => {
    assert.deepEqual(drugQueryAt('1.met'), { start: 2, query: 'met' });
    assert.deepEqual(drugQueryAt('2) 胃'), { start: 3, query: '胃' });
  });

  it('英文一個字、純數字、空白結尾都不比', () => {
    assert.equal(drugQueryAt('m'), null);
    assert.equal(drugQueryAt('0.5'), null);
    assert.equal(drugQueryAt('met '), null);
    assert.equal(drugQueryAt(''), null);
  });
});

describe('rankDrugs', () => {
  const drugs = [
    { _id: '1', name: 'Metoclopramide（胃排空劑）' },
    { _id: '2', name: 'Famotidine（胃藥）' },
    { _id: '3', name: 'Mirtazapine' },
    { _id: '4', name: 'Prednisolone met' },
    { _id: '5', name: 'Cimetidine' },
    { _id: '6', name: 'Metronidazole', enabled: false },
  ];

  it('英文不分大小寫：開頭符合 > 字首符合 > 中間符合，停用的不出現', () => {
    assert.deepEqual(rankDrugs(drugs, 'MET').map((drug) => drug._id), ['1', '4', '5']);
  });

  it('中文任何位置都算，同一級依名稱', () => {
    assert.deepEqual(rankDrugs(drugs, '胃').map((drug) => drug._id), ['2', '1']);
  });

  it('帶回符合的位置給畫面標示；已經打完整的不再建議', () => {
    const [first] = rankDrugs(drugs, '胃排空');
    assert.equal(first.matchStart, 15);
    assert.equal(first.matchLength, 3);
    assert.deepEqual(rankDrugs(drugs, 'mirtazapine'), []);
  });
});
