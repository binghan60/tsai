import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planVisitMedication } from './visitMedicationOrder.js';

test('planVisitMedication：沒有連著的藥單時，有內容才新開', () => {
  assert.equal(planVisitMedication('', null), 'none');
  assert.equal(planVisitMedication('[red] [/red]', null), 'none', '只剩格式標記算空白');
  assert.equal(planVisitMedication('Amoxicillin 5 天', null), 'create');
});

test('planVisitMedication：流程中的藥單跟著醫師的內容走', () => {
  const order = { status: 'approved', prescription: 'Amoxicillin 5 天' };
  assert.equal(planVisitMedication('Amoxicillin 5 天', order), 'none');
  assert.equal(planVisitMedication(' Amoxicillin 5 天 ', order), 'none');
  assert.equal(planVisitMedication('Amoxicillin 7 天', order), 'update');
  assert.equal(planVisitMedication('', { ...order, status: 'ready' }), 'cancel');
});

test('planVisitMedication：已領藥或已取消的不回頭改，內容不同才另開一張', () => {
  const order = { status: 'collected', prescription: 'Amoxicillin 5 天' };
  assert.equal(planVisitMedication('Amoxicillin 5 天', order), 'none');
  assert.equal(planVisitMedication('Amoxicillin 7 天', order), 'create');
  assert.equal(planVisitMedication('', order), 'none');
  assert.equal(planVisitMedication('Amoxicillin 5 天', { ...order, status: 'cancelled' }), 'none');
});
