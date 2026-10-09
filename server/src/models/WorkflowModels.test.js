import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import DeliveryLog from './DeliveryLog.js';
import FormTemplate from './FormTemplate.js';
import Owner from './Owner.js';
import Pet from './Pet.js';
import TextTemplate from './TextTemplate.js';

describe('cross-document workflow schemas', () => {
  it('keeps an explicit event for SMTP outcomes that need manual confirmation', () => {
    assert.ok(DeliveryLog.schema.path('event').enumValues.includes('uncertain'));
  });

  it('links queued and outcome events from the same delivery attempt', () => {
    assert.equal(DeliveryLog.schema.path('attemptId').instance, 'String');
  });

  it('uses optimistic concurrency for form template edits', () => {
    assert.equal(FormTemplate.schema.options.optimisticConcurrency, true);
  });

  it('uses optimistic concurrency for owner and pet edits', () => {
    assert.equal(Owner.schema.options.optimisticConcurrency, true);
    assert.equal(Pet.schema.options.optimisticConcurrency, true);
  });

  it('supports named long-form text templates with field scopes', () => {
    assert.equal(TextTemplate.schema.path('name').options.maxlength, 80);
    // 內容帶格式標記，上限算純文字：標記不佔額度。
    assert.equal(new TextTemplate({ name: 'a', content: `**${'字'.repeat(2000)}**`, availableForAllFields: true }).validateSync(), undefined);
    assert.ok(new TextTemplate({ name: 'a', content: '字'.repeat(2001), availableForAllFields: true }).validateSync()?.errors.content);
    assert.equal(TextTemplate.schema.path('category'), undefined);
    assert.equal(TextTemplate.schema.path('availableForAllFields').instance, 'Boolean');
    assert.equal(TextTemplate.schema.path('applicableItemKeys').instance, 'Array');
    assert.equal(TextTemplate.schema.options.optimisticConcurrency, true);
  });

});
