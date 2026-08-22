import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ageLabel, clinicDateInput } from './datetime.js';

describe('clinic date helpers', () => {
  it('uses the Taipei calendar day around UTC midnight', () => {
    assert.equal(clinicDateInput('2026-08-21T16:30:00.000Z'), '2026-08-22');
  });

  it('calculates age against the visit date instead of the current clock', () => {
    assert.equal(ageLabel('2025-06-15T00:00:00.000Z', '2026-08-14T00:00:00.000Z'), '1 歲 1 個月');
  });
});
