import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breedText, isNeutered, sexLabel } from './petDisplay.js';

test('性別只認 male／female，其餘不顯示', () => {
  assert.equal(sexLabel('male'), '公');
  assert.equal(sexLabel('female'), '母');
  assert.equal(sexLabel('unknown'), '');
  assert.equal(sexLabel(undefined), '');
});

test('只有確定結紮才出標記', () => {
  assert.equal(isNeutered('yes'), true);
  assert.equal(isNeutered('no'), false);
  assert.equal(isNeutered('unknown'), false);
});

test('沒有品種時退回掛號記的物種文字', () => {
  assert.equal(breedText({ breed: '米克斯' }, '貓'), '米克斯');
  assert.equal(breedText({ breed: '' }, '貓'), '貓');
  assert.equal(breedText(null), '');
});
