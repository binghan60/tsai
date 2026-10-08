import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyOwnerDraft, emptyPetDraft, ownerDraftTouched, petDraftTouched } from './formDrafts.js';

test('空白草稿不算填過', () => {
  assert.equal(petDraftTouched(emptyPetDraft()), false);
  assert.equal(ownerDraftTouched(emptyOwnerDraft()), false);
});

test('只有空白字元、清空的數字欄位不算填過', () => {
  assert.equal(petDraftTouched({ ...emptyPetDraft(), name: '  ', weightKg: '' }), false);
  assert.equal(ownerDraftTouched({ ...emptyOwnerDraft(), phone: ' ' }), false);
});

test('改了任何一欄就算填過，包含選項與勾選', () => {
  assert.equal(petDraftTouched({ ...emptyPetDraft(), name: '豆豆' }), true);
  assert.equal(petDraftTouched({ ...emptyPetDraft(), sex: 'male' }), true);
  assert.equal(petDraftTouched({ ...emptyPetDraft(), birthDateEstimated: true }), true);
  assert.equal(petDraftTouched({ ...emptyPetDraft(), foods: ['乾糧'] }), true);
  assert.equal(petDraftTouched({ ...emptyPetDraft(), weightKg: 4.2 }), true);
  assert.equal(ownerDraftTouched({ ...emptyOwnerDraft(), name: '王小姐' }), true);
});
