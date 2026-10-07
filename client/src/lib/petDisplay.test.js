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
  // 存的是 IDEXX 英文名稱，顯示轉中文；清單以外的舊值照原文
  assert.equal(breedText({ breed: 'British Shorthair' }, '貓'), '英國短毛貓');
  assert.equal(breedText({ breed: 'mixed' }), '米克斯');
  assert.equal(breedText({ breed: 'Poodle' }, '狗'), 'Poodle');
  assert.equal(breedText({ breed: '' }, '貓'), '貓');
  assert.equal(breedText(null), '');
});

test('清單提醒：過敏、病史第一項、備註（咬人叫注意）', async () => {
  const { petReminders } = await import('./petDisplay.js');
  const tags = petReminders({ allergyStatus: 'yes', allergyType: '盤尼西林', medicalHistory: ['無', '慢性腎病', '甲亢'], notes: '會咬人，保定需兩人' });
  assert.deepEqual(tags.map((tag) => [tag.key, tag.label]), [['allergy', '過敏'], ['history', '慢性腎病'], ['notes', '注意']]);
  assert.equal(tags[1].title, '病史：慢性腎病、甲亢');
  assert.deepEqual(petReminders({ allergyStatus: 'none', medicalHistory: ['無'], notes: '' }), []);
});
