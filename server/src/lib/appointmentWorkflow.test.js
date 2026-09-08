import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyWorkflowAction, appointmentJournalContent, assertWorkflowVersion } from './appointmentWorkflow.js';
import { workflowState, workflowFilter } from '../../../shared/appointmentWorkflow.js';

const appointment = () => ({ __v: 0, status: 'arrived', petId: 'pet-1', checkinNumber: 3, checkinNumberHistory: [3], billingSubtotal: 850 });
test('appointment journal combines the simple note with this visit’s measurements', () => {
  assert.equal(appointmentJournalContent({ visitNote: '皮膚狀況穩定', weightKg: 4.2, temperatureC: 38.5 }), '體重：4.2 kg　體溫：38.5 °C\n\n皮膚狀況穩定');
  assert.equal(appointmentJournalContent({ visitNote: '', weightKg: null, temperatureC: 38.1 }), '體溫：38.1 °C');
});
test('billing and payment can finish before the visit; only the last milestone releases the queue number', () => {
  const p = appointment();
  applyWorkflowAction(p, 'bill', {});
  assert.deepEqual(workflowState(p), { started: false, visited: false, billed: true, paid: false });
  applyWorkflowAction(p, 'pay', { billingRevision: 1, checkoutTotal: 850, paymentMethod: 'cash' });
  assert.equal(workflowState(p).visited, false);
  assert.equal(p.status, 'pending_checkout');
  assert.equal(p.checkinNumber, 3);
  applyWorkflowAction(p, 'finish', {});
  assert.equal(p.status, 'completed');
  assert.equal(p.checkinNumber, null);
  assert.deepEqual(p.checkinNumberHistory, [3]);
});
test('visit completion alone neither bills nor collects money', () => {
  const p = appointment();
  applyWorkflowAction(p, 'finish', {});
  assert.equal(workflowState(p).billed, false);
  assert.equal(workflowFilter(p, 'billing'), true);
  assert.equal(workflowFilter(p, 'waiting'), false);
  assert.throws(() => applyWorkflowAction(p, 'pay', { paymentMethod: 'cash' }), { status: 409 });
});
test('reject stale versions, stale billing revisions, duplicate payments and changes after payment', () => {
  const p = appointment();
  assert.throws(() => assertWorkflowVersion(p, undefined), { status: 409 });
  assert.throws(() => assertWorkflowVersion(p, 1), { status: 409 });
  applyWorkflowAction(p, 'bill', {});
  assert.throws(() => applyWorkflowAction(p, 'pay', { billingRevision: 0, paymentMethod: 'cash' }), { status: 409 });
  assert.throws(() => applyWorkflowAction(p, 'clinical', { billingItems: [] }), { status: 409 });
  applyWorkflowAction(p, 'pay', { billingRevision: 1, checkoutTotal: 850, paymentMethod: 'card' });
  assert.throws(() => applyWorkflowAction(p, 'pay', { billingRevision: 1, paymentMethod: 'cash' }), { status: 409 });
  assert.throws(() => applyWorkflowAction(p, 'unbill', {}), { status: 409 });
});
test('zero payments are valid; adjustments need reasons and invalid amounts are rejected', () => {
  const p = appointment();
  applyWorkflowAction(p, 'bill', {});
  for (const checkoutTotal of ['', null, -1, 'NaN']) assert.throws(() => applyWorkflowAction(p, 'pay', { billingRevision: 1, checkoutTotal, paymentMethod: 'cash' }), { status: 422 });
  assert.throws(() => applyWorkflowAction(p, 'pay', { billingRevision: 1, checkoutTotal: 0, paymentMethod: 'cash' }), { status: 422 });
  applyWorkflowAction(p, 'pay', { billingRevision: 1, checkoutTotal: 0, checkoutAdjustmentNote: '免費複診', paymentMethod: 'cash' });
  assert.equal(p.checkoutTotal, 0);
});
test('legacy paid and pending-checkout visits keep their milestone meaning', () => {
  const p = { ...appointment(), status: 'pending_checkout' };
  assert.equal(workflowState(p).visited, true);
  applyWorkflowAction(p, 'clinical', { visitNote: 'updated' });
  assert.equal(workflowState(p).visited, true);
  assert.equal(workflowState(p).paid, false);
  const completed = { ...appointment(), status: 'completed', checkoutTotal: 850 };
  applyWorkflowAction(completed, 'clinical', { visitNote: 'updated' });
  assert.equal(workflowState(completed).paid, true);
});
test('withdraw and reissue billing invalidates previous payment confirmations', () => {
  const p = appointment();
  applyWorkflowAction(p, 'bill', {});
  applyWorkflowAction(p, 'unbill', {});
  applyWorkflowAction(p, 'clinical', { billingItems: [{ name: '看診', quantity: 2, unitPrice: 500, amount: 1000 }] });
  applyWorkflowAction(p, 'bill', {});
  assert.equal(p.billingSubtotal, 1000);
  assert.equal(p.billingRevision, 3);
  assert.throws(() => applyWorkflowAction(p, 'pay', { billingRevision: 1, paymentMethod: 'cash' }), { status: 409 });
});
