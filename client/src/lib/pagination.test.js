import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { paginationItems } from './pagination.js';

const labels = (items) => items.map((item) => item.type === 'page' ? item.value : '…');

describe('paginationItems', () => {
  it('七頁以內完整展開所有頁碼', () => {
    assert.deepEqual(labels(paginationItems(4, 7)), [1, 2, 3, 4, 5, 6, 7]);
  });

  it('靠近前段時顯示前五頁與最後一頁', () => {
    assert.deepEqual(labels(paginationItems(3, 20)), [1, 2, 3, 4, 5, '…', 20]);
  });

  it('位於中段時保留目前頁前後頁與兩端頁碼', () => {
    assert.deepEqual(labels(paginationItems(10, 20)), [1, '…', 9, 10, 11, '…', 20]);
  });

  it('靠近尾端時顯示第一頁與最後五頁', () => {
    assert.deepEqual(labels(paginationItems(18, 20)), [1, '…', 16, 17, 18, 19, 20]);
  });

  it('輸入超出範圍時仍產生有效頁碼', () => {
    assert.deepEqual(labels(paginationItems(99, 3)), [1, 2, 3]);
  });
});
