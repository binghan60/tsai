import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clinicalDraft, draftPatch, mergeClinicalUpdate } from './visitDraft.js';
test('remote payment updates preserve an unsaved clinical note without a false conflict', () => {
  const original = { visitNote: 'old', billingItems: [] };
  const base = clinicalDraft(original);
  const draft = { ...base, visitNote: 'typing' };
  const result = mergeClinicalUpdate(draft, base, { ...original, paymentCompletedAt: '2026-09-07' });
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
