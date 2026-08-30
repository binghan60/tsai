import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import MedicalRecord from './MedicalRecord.js';

describe('MedicalRecord workflow constraints', () => {
  it('keeps operational attempt identifiers out of normal API projections', () => {
    assert.equal(MedicalRecord.schema.path('finalizeAttemptId').options.select, false);
    assert.equal(MedicalRecord.schema.path('deliveryAttemptId').options.select, false);
    assert.equal(MedicalRecord.schema.path('deliveryLeaseExpiresAt').options.select, false);
    assert.equal(MedicalRecord.schema.path('pdfFileId').options.select, false);
  });

  it('declares unique constraints for draft revisions and revision versions', () => {
    const indexes = MedicalRecord.schema.indexes();
    assert.ok(indexes.some(([keys, options]) => keys.revisionOf === 1 && keys.status === 1 && options.unique));
    assert.ok(indexes.some(([keys, options]) => keys.revisionRootId === 1 && keys.reportVersion === 1 && options.unique));
  });

  it('represents uncertain mail outcomes and rejects silent document overwrites', () => {
    assert.ok(MedicalRecord.schema.path('deliveryStatus').enumValues.includes('uncertain'));
    assert.deepEqual(MedicalRecord.schema.path('pdfStatus').enumValues, ['pending', 'generating', 'ready', 'failed']);
    assert.equal(MedicalRecord.schema.options.optimisticConcurrency, true);
  });
});
