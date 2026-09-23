import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyJournalFields, applyWorkflowAction, appointmentJournalContent, appointmentJournalSections, assertWorkflowVersion } from './appointmentWorkflow.js';
import { workflowState, workflowFilter, visitLabel } from '../../../shared/appointmentWorkflow.js';

const appointment = () => ({ __v: 0, status: 'arrived', petId: 'pet-1', checkinNumber: 3, checkinNumberHistory: [3] });

test('appointment journal combines the simple note with this visit’s measurements', () => {
  assert.equal(appointmentJournalContent({ reason: ' 咳嗽三天 ', visitNote: '安排檢查', weightKg: 4.2, temperatureC: 38.5 }), '來院原因：咳嗽三天\n\n體重：4.2 kg　體溫：38.5 °C\n\n安排檢查');
  assert.equal(appointmentJournalContent({ reason: '定期回診' }), '來院原因：定期回診');
  assert.equal(appointmentJournalContent({ reason: '  ', visitNote: '' }), '');
  assert.equal(appointmentJournalContent({ visitNote: '皮膚狀況穩定', weightKg: 4.2, temperatureC: 38.5 }), '體重：4.2 kg　體溫：38.5 °C\n\n皮膚狀況穩定');
  assert.equal(appointmentJournalContent({ visitNote: '', weightKg: null, temperatureC: 38.1 }), '體溫：38.1 °C');
});

test('appointment journal also carries the owner-facing care note and the follow-up recommendation, but never the internal note', () => {
  assert.equal(
    appointmentJournalContent({ visitNote: '安排檢查', specialCareNote: ' 傷口勿舔舐 ', followUpRecommendation: ' 兩週後回診拆線 ' }),
    '安排檢查\n\n請轉告飼主：傷口勿舔舐\n\n回診建議：兩週後回診拆線'
  );
  assert.equal(
    appointmentJournalContent({ visitNote: '安排檢查', specialCareNote: '傷口勿舔舐', followUpRecommendation: '兩週後回診拆線', internalNote: '院內追蹤用' }),
    '安排檢查\n\n請轉告飼主：傷口勿舔舐\n\n回診建議：兩週後回診拆線'
  );
  assert.equal(appointmentJournalContent({ visitNote: '安排檢查', specialCareNote: '  ', followUpRecommendation: '' }), '安排檢查');
});

test('appointment journal sections keep each field separate, in reading order, without empty or internal fields', () => {
  assert.deepEqual(
    appointmentJournalSections({ reason: ' 咳嗽 ', weightKg: 4.2, temperatureC: null, visitNote: '安排檢查', internalNote: '院內追蹤用', specialCareNote: '  ', followUpRecommendation: '兩週後回診' }),
    [
      { key: 'reason', label: '來院原因', text: '咳嗽' },
      { key: 'weightKg', label: '體重', text: '4.2 kg' },
      { key: 'visitNote', label: '本次簡易紀錄', text: '安排檢查' },
      { key: 'followUpRecommendation', label: '回診建議', text: '兩週後回診' },
    ]
  );
  assert.deepEqual(appointmentJournalSections({ weightKg: 0 }), [{ key: 'weightKg', label: '體重', text: '0 kg' }]);
});

test('journal edits write every journal field back regardless of workflow stage, but never internal notes', () => {
  const visit = { status: 'completed', deskCompletedAt: new Date(), reason: '舊', visitNote: '紀錄', internalNote: '院內', weightKg: 3 };
  applyJournalFields(visit, { reason: ' 新原因 ', weightKg: '4.5', temperatureC: '', internalNote: '不該被改', handoffNote: '也不該' });
  assert.equal(visit.reason, '新原因');
  assert.equal(visit.weightKg, 4.5);
  assert.equal(visit.temperatureC, null);
  assert.equal(visit.internalNote, '院內');
  assert.equal(visit.handoffNote, undefined);
  assert.throws(() => applyJournalFields(visit, { weightKg: -1 }), /非負數/);
  assert.throws(() => applyJournalFields(visit, { specialCareNote: 'x'.repeat(501) }), /最多 500 字/);
  assert.throws(() => applyJournalFields({}, { reason: '' }), /不能全部清空/);
});

test('the four steps run in order and only the desk releases the queue number', () => {
  const p = appointment();
  applyWorkflowAction(p, 'start', {});
  assert.deepEqual(workflowState(p), { started: true, handedOff: false, completed: false });
  assert.equal(p.status, 'arrived');

  applyWorkflowAction(p, 'handoff', {});
  assert.equal(p.status, 'pending_checkout');
  assert.equal(visitLabel(p), '已交櫃台');
  // 人還在診所等櫃台，號碼牌不歸還。
  assert.equal(p.checkinNumber, 3);

  applyWorkflowAction(p, 'complete', {});
  assert.equal(p.status, 'completed');
  assert.equal(p.checkinNumber, null);
  assert.deepEqual(p.checkinNumberHistory, [3]);
});

test('handing off without an explicit start still records the visit as started', () => {
  const p = appointment();
  applyWorkflowAction(p, 'handoff', {});
  assert.equal(workflowState(p).started, true);
  assert.ok(p.visitStartedAt);
});

test('the vet can reclaim a visit until the desk completes it', () => {
  const p = appointment();
  applyWorkflowAction(p, 'handoff', {});
  applyWorkflowAction(p, 'reclaim', {});
  assert.deepEqual(workflowState(p), { started: true, handedOff: false, completed: false });
  assert.equal(p.status, 'arrived');
  assert.equal(visitLabel(p), '看診中');

  applyWorkflowAction(p, 'clinical', { handoffNote: '補開止咳藥' });
  applyWorkflowAction(p, 'handoff', {});
  applyWorkflowAction(p, 'complete', {});
  assert.throws(() => applyWorkflowAction(p, 'reclaim', {}), { status: 409 });
});

test('reclaiming a visit that was never handed off is refused', () => {
  const p = appointment();
  assert.throws(() => applyWorkflowAction(p, 'reclaim', {}), { status: 409 });
});

test('the desk cannot complete before the vet hands off, and cannot complete twice', () => {
  const p = appointment();
  assert.throws(() => applyWorkflowAction(p, 'complete', {}), { status: 409 });
  applyWorkflowAction(p, 'handoff', {});
  assert.throws(() => applyWorkflowAction(p, 'handoff', {}), { status: 409 });
  applyWorkflowAction(p, 'complete', {});
  assert.throws(() => applyWorkflowAction(p, 'complete', {}), { status: 409 });
});

test('clinical text and measurements are trimmed, validated and journal notes stay editable after handoff', () => {
  const p = appointment();
  applyWorkflowAction(p, 'clinical', { visitNote: '  夜咳為主  ', internalNote: '  院內留存  ', handoffNote: ' 診察費＋X光 ', weightKg: '5.2', temperatureC: '' });
  assert.equal(p.visitNote, '夜咳為主');
  assert.equal(p.internalNote, '院內留存');
  assert.equal(p.handoffNote, '診察費＋X光');
  assert.equal(p.weightKg, 5.2);
  assert.equal(p.temperatureC, null);
  assert.throws(() => applyWorkflowAction(p, 'clinical', { weightKg: -1 }), { status: 422 });

  applyWorkflowAction(p, 'handoff', {});
  applyWorkflowAction(p, 'clinical', { visitNote: '  櫃台補充用藥說明  ' });
  assert.equal(p.visitNote, '櫃台補充用藥說明');
  applyWorkflowAction(p, 'clinical', { internalNote: '  院內補充  ' });
  assert.equal(p.internalNote, '院內補充');
  assert.equal(p.status, 'pending_checkout');
  assert.throws(() => applyWorkflowAction(p, 'clinical', { handoffNote: '更改收費項目' }), { status: 409 });
  assert.throws(() => applyWorkflowAction(p, 'clinical', { weightKg: 5.4 }), { status: 409 });
  assert.throws(() => applyWorkflowAction(p, 'clinical', { specialCareNote: '傷口勿舔舐' }), { status: 409 });
  applyWorkflowAction(p, 'reclaim', {});
  applyWorkflowAction(p, 'clinical', { specialCareNote: '傷口勿舔舐' });
  assert.equal(p.specialCareNote, '傷口勿舔舐');
  applyWorkflowAction(p, 'handoff', {});
  applyWorkflowAction(p, 'complete', {});
  assert.throws(() => applyWorkflowAction(p, 'clinical', { visitNote: '再改一次' }), { status: 409 });
});

test('unknown actions and visits that have not checked in are refused', () => {
  assert.throws(() => applyWorkflowAction(appointment(), 'pay', {}), { status: 422 });
  assert.throws(() => applyWorkflowAction({ status: 'scheduled', petId: 'pet-1' }, 'start', {}), { status: 422 });
  assert.throws(() => applyWorkflowAction({ status: 'arrived', petId: null }, 'start', {}), { status: 422 });
});

test('reject stale versions', () => {
  const p = appointment();
  assert.throws(() => assertWorkflowVersion(p, undefined), { status: 409 });
  assert.throws(() => assertWorkflowVersion(p, 1), { status: 409 });
  assert.doesNotThrow(() => assertWorkflowVersion(p, 0));
});

test('legacy visits keep their stage when the new workflow first touches them', () => {
  // 舊版（批價／收款）沒有 handoffAt/deskCompletedAt，靠 status 回推。
  const handedOff = { ...appointment(), status: 'pending_checkout' };
  assert.deepEqual(workflowState(handedOff), { started: true, handedOff: true, completed: false });
  applyWorkflowAction(handedOff, 'clinical', { visitNote: '櫃台補充' });
  assert.equal(handedOff.visitNote, '櫃台補充');
  assert.equal(handedOff.workflowVersion, 2);
  assert.equal(handedOff.status, 'pending_checkout');
  assert.ok(handedOff.handoffAt);

  const done = { ...appointment(), status: 'completed' };
  assert.deepEqual(workflowState(done), { started: true, handedOff: true, completed: true });
});

test('every filter key owns one segment of the line, so the counts partition the day', () => {
  const day = [
    { status: 'scheduled' },
    { workflowVersion: 2, status: 'arrived', petId: 'p' },
    { workflowVersion: 2, status: 'arrived', petId: 'p', visitStartedAt: new Date() },
    { workflowVersion: 2, status: 'pending_checkout', petId: 'p', visitStartedAt: new Date(), handoffAt: new Date() },
    { workflowVersion: 2, status: 'completed', petId: 'p', visitStartedAt: new Date(), handoffAt: new Date(), deskCompletedAt: new Date() },
    { status: 'cancelled' },
  ];
  const buckets = ['scheduled', 'waiting', 'visiting', 'handoff', 'completed', 'cancelled'];
  const counts = buckets.map(key => day.filter(item => workflowFilter(item, key)).length);
  assert.deepEqual(counts, [1, 1, 1, 1, 1, 1]);
  assert.equal(counts.reduce((sum, n) => sum + n, 0), day.length);
  // 櫃台的「在院中」就是候診＋看診中這兩段合起來。
  assert.equal(day.filter(item => workflowFilter(item, 'onsite')).length, 2);
});

test('follow-up bucket only holds visits the vet asked to return that have no booking yet', () => {
  const base = { workflowVersion: 2, status: 'pending_checkout', petId: 'p', handoffAt: new Date() };
  assert.equal(workflowFilter({ ...base, followUpRecommendation: '兩週後複查' }, 'followup'), true);
  assert.equal(workflowFilter({ ...base, followUpRecommendation: '兩週後複查', followUpAppointmentId: 'a1' }, 'followup'), false);
  assert.equal(workflowFilter(base, 'followup'), false);
});
