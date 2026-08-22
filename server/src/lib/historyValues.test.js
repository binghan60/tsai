import assert from 'node:assert/strict';
import test from 'node:test';
import MedicalRecord from '../models/MedicalRecord.js';
import { enrichSectionsWithPreviousValues } from './historyValues.js';

test('enrichSectionsWithPreviousValues preserves Mongoose section fields', () => {
  const record = new MedicalRecord({
    petId: '64b64c9f4dc7c8b44c10e123',
    sections: [{
      key: 'blood',
      title: '血檢',
      presentation: 'table',
      items: [{ key: 'wbc', label: '白血球', type: 'lab', value: '12', status: 'normal' }],
    }],
  });

  const sections = enrichSectionsWithPreviousValues(record.sections, {
    byKey: { wbc: { value: '10', unit: 'K/uL', visitDate: new Date('2026-08-01') } },
    byLabel: {},
  });

  assert.equal(sections[0].key, 'blood');
  assert.equal(sections[0].title, '血檢');
  assert.equal(sections[0].presentation, 'table');
  assert.equal(sections[0].items[0].key, 'wbc');
  assert.equal(sections[0].items[0].previousValue, '10');
});

test('MedicalRecord sections retain frozen previous values', () => {
  const record = new MedicalRecord({
    petId: '64b64c9f4dc7c8b44c10e123',
    sections: [{
      key: 'blood',
      title: '血檢',
      items: [{
        key: 'wbc', label: '白血球', type: 'lab', value: '12',
        previousValue: '10', previousUnit: 'K/uL', previousVisitDate: new Date('2026-08-01'),
      }],
    }],
  });

  const item = record.toJSON().sections[0].items[0];
  assert.equal(item.previousValue, '10');
  assert.equal(item.previousUnit, 'K/uL');
  assert.equal(item.previousVisitDate.toISOString(), '2026-08-01T00:00:00.000Z');
});
