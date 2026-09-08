import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clinicalDraft, draftPatch, mergeClinicalUpdate } from './visitDraft.js';

test('remote workflow updates preserve an unsaved clinical note without a false conflict', () => {
  const original = { visitNote: 'old' };
  const base = clinicalDraft(original);
  const draft = { ...base, visitNote: 'typing' };
  const result = mergeClinicalUpdate(draft, base, { ...original, deskCompletedAt: '2026-09-07' });
  assert.equal(result.draft.visitNote, 'typing');
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(draftPatch(result.draft, result.baseline), { visitNote: 'typing' });
});

test('concurrent edits to the same clinical field require a user decision', () => {
  const base = clinicalDraft({ visitNote: 'old' });
  const result = mergeClinicalUpdate({ ...base, visitNote: 'local' }, base, { visitNote: 'remote', specialCareNote: 'new reminder' });
  assert.deepEqual(result.conflicts, ['visitNote']);
  assert.equal(result.draft.visitNote, 'local');
  assert.equal(result.baseline.visitNote, 'remote');
  assert.equal(result.draft.specialCareNote, 'new reminder');
});

test('the draft carries the four text fields the vet fills in one screen', () => {
  const draft = clinicalDraft({ handoffNote: '診察費', specialCareNote: '勿舔舐', followUpRecommendation: '兩週後', visitNote: '心雜音' });
  assert.deepEqual(draftPatch({ ...draft, handoffNote: '診察費＋X光' }, draft), { handoffNote: '診察費＋X光' });
  // 空欄位一律正規化成空字串，載入舊資料時不會被當成「有變更」。
  assert.equal(clinicalDraft({}).handoffNote, '');
});
