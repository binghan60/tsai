import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clinicalDraft, draftPatch, mergeClinicalUpdate, takeBaseline } from './visitDraft.js';

test('量測在草稿裡是字串，伺服器的數字跟畫面上的同一個值不算變更', () => {
  const base = clinicalDraft({ weightKg: 4.2, temperatureC: null });
  assert.deepEqual([base.weightKg, base.temperatureC], ['4.2', '']);
  assert.deepEqual(draftPatch({ ...base, weightKg: '4.2' }, base), {});
  assert.deepEqual(draftPatch({ ...base, temperatureC: '38.5' }, base), { temperatureC: '38.5' });
});

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

test('the draft carries the text fields the vet fills in one screen; the handoff note is gone', () => {
  const draft = clinicalDraft({ specialCareNote: '勿舔舐', followUpRecommendation: '兩週後', visitNote: '心雜音', handoffNote: '舊資料' });
  assert.deepEqual(draftPatch({ ...draft, followUpRecommendation: '一週後' }, draft), { followUpRecommendation: '一週後' });
  assert.equal('handoffNote' in draft, false);
  // 空欄位一律正規化成空字串，載入舊資料時不會被當成「有變更」。
  assert.equal(clinicalDraft({}).specialCareNote, '');
});

test('lab values are compared and sent per item; clearing one sends an empty string', () => {
  const base = clinicalDraft({ labValues: [{ key: 'wbc', value: '12' }, { key: 'alt', value: '80' }] });
  const draft = { ...base, labs: { ...base.labs, wbc: '22.4' } };
  delete draft.labs.alt;
  assert.deepEqual(draftPatch(draft, base), { labValues: { wbc: '22.4', alt: '' } });
  assert.deepEqual(draftPatch(base, base), {});
});

test('a remote lab edit on another item merges in; the same item edited on both sides conflicts', () => {
  const base = clinicalDraft({ labValues: [{ key: 'wbc', value: '12' }] });
  const local = { ...base, labs: { wbc: '15' } };
  const merged = mergeClinicalUpdate(local, base, { labValues: [{ key: 'wbc', value: '12' }, { key: 'alt', value: '168' }] });
  assert.deepEqual(merged.draft.labs, { wbc: '15', alt: '168' });
  assert.deepEqual(merged.conflicts, []);

  const clash = mergeClinicalUpdate(local, base, { labValues: [{ key: 'wbc', value: '18' }] });
  assert.deepEqual(clash.conflicts, ['lab:wbc']);
  takeBaseline(clash.draft, clash.baseline, 'lab:wbc');
  assert.equal(clash.draft.labs.wbc, '18');
});
