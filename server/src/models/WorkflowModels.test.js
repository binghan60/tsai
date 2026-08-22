import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import DeletedMedicalRecord from './DeletedMedicalRecord.js';
import DeliveryLog from './DeliveryLog.js';
import FormTemplate from './FormTemplate.js';

describe('cross-document workflow schemas', () => {
  it('deduplicates deletion audit snapshots by original record', () => {
    const index = DeletedMedicalRecord.schema.indexes()
      .find(([keys]) => keys.originalId === 1);
    assert.ok(index);
    assert.equal(index[1].unique, true);
  });

  it('keeps an explicit event for SMTP outcomes that need manual confirmation', () => {
    assert.ok(DeliveryLog.schema.path('event').enumValues.includes('uncertain'));
  });

  it('uses optimistic concurrency for form template edits', () => {
    assert.equal(FormTemplate.schema.options.optimisticConcurrency, true);
  });
});
