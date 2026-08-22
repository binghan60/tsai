import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import DeletedMedicalRecord from './DeletedMedicalRecord.js';
import DeliveryLog from './DeliveryLog.js';
import FormTemplate from './FormTemplate.js';
import Owner from './Owner.js';
import Pet from './Pet.js';

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

  it('uses optimistic concurrency for owner and pet edits', () => {
    assert.equal(Owner.schema.options.optimisticConcurrency, true);
    assert.equal(Pet.schema.options.optimisticConcurrency, true);
  });

  it('indexes active deletion snapshots for the recycle bin', () => {
    const index = DeletedMedicalRecord.schema.indexes()
      .find(([keys]) => keys.restoredAt === 1 && keys.deletedAt === -1);
    assert.ok(index);
  });
});
