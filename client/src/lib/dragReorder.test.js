import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clampDragOffset, dragShift, dropBeforeId, dropIndex, stepBeforeId } from './dragReorder.js';
import { moveBefore } from '../../../shared/todoOrder.js';

// 四列、每列 50 高。
const rows = [0, 50, 100, 150].map((top) => ({ top, height: 50 }));

describe('dragReorder', () => {
  it('拖拉範圍限制在清單內', () => {
    assert.equal(clampDragOffset(rows, 1, -200), -50);
    assert.equal(clampDragOffset(rows, 1, 500), 100);
    assert.equal(clampDragOffset(rows, 1, 30), 30);
  });

  it('中線越過別列的中線才換位置', () => {
    assert.equal(dropIndex(rows, 0, 0), 0);
    assert.equal(dropIndex(rows, 0, 24), 0);
    assert.equal(dropIndex(rows, 0, 26), 1);
    assert.equal(dropIndex(rows, 0, 150), 3);
    assert.equal(dropIndex(rows, 3, -150), 0);
    assert.equal(dropIndex(rows, 2, -60), 1);
  });

  it('中間的列往反方向讓一列', () => {
    assert.deepEqual([0, 1, 2, 3].map((i) => dragShift(i, 0, 2, 50)), [0, -50, -50, 0]);
    assert.deepEqual([0, 1, 2, 3].map((i) => dragShift(i, 3, 1, 50)), [0, 50, 50, 0]);
    assert.deepEqual([0, 1, 2, 3].map((i) => dragShift(i, 1, 1, 50)), [0, 0, 0, 0]);
  });

  it('這一頁的拖放換成整份清單的 beforeId', () => {
    const all = ['a', 'b', 'c', 'd', 'e', 'f'];
    const page = ['c', 'd', 'e'];
    assert.equal(dropBeforeId(all, page, 2, 0), 'c');
    assert.equal(dropBeforeId(all, page, 0, 1), 'e');
    // 放到這一頁最後一格：接在 e 後面，也就是 f 前面。
    assert.equal(dropBeforeId(all, page, 0, 2), 'f');
    // 最後一頁的最後一格：移到整份最後。
    assert.equal(dropBeforeId(all, ['e', 'f'], 0, 1), null);
    // 換算後的結果跟直接在畫面上排的一樣。
    assert.deepEqual(moveBefore(all, 'c', dropBeforeId(all, page, 0, 2)), ['a', 'b', 'd', 'e', 'c', 'f']);
  });

  it('鍵盤上下移一格', () => {
    const all = ['a', 'b', 'c'];
    assert.equal(stepBeforeId(all, 'a', -1), null);
    assert.deepEqual(stepBeforeId(all, 'b', -1), { beforeId: 'a' });
    assert.deepEqual(stepBeforeId(all, 'a', 1), { beforeId: 'c' });
    assert.deepEqual(stepBeforeId(all, 'b', 1), { beforeId: null });
    assert.equal(stepBeforeId(all, 'c', 1), null);
  });
});

describe('todoOrder.moveBefore', () => {
  it('插到 beforeId 前面；null 移到最後；找不到回 null', () => {
    assert.deepEqual(moveBefore(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b']);
    assert.deepEqual(moveBefore(['a', 'b', 'c'], 'a', null), ['b', 'c', 'a']);
    assert.equal(moveBefore(['a', 'b'], 'x', null), null);
    assert.equal(moveBefore(['a', 'b'], 'a', 'x'), null);
  });
});
