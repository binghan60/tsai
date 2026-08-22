import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { paginatedPayload, paginationMeta, paginationOptions } from './pagination.js';

describe('pagination helpers', () => {
  it('normalizes invalid values and calculates the offset', () => {
    assert.deepEqual(paginationOptions({ page: '-2', limit: 'nope' }), { page: 1, limit: 25, skip: 0 });
    assert.deepEqual(paginationOptions({ page: '3', limit: '20' }), { page: 3, limit: 20, skip: 40 });
  });

  it('caps limits and supports namespaced query parameters', () => {
    assert.deepEqual(
      paginationOptions(
        { petPage: '2', petLimit: '1000' },
        { defaultLimit: 12, maxLimit: 50, pageParam: 'petPage', limitParam: 'petLimit' }
      ),
      { page: 2, limit: 50, skip: 50 }
    );
  });

  it('returns at least one page for an empty collection', () => {
    assert.deepEqual(paginatedPayload([], 0, { page: 1, limit: 25 }), {
      items: [], total: 0, page: 1, limit: 25, totalPages: 1,
    });
    assert.deepEqual(paginationMeta(26, { page: 2, limit: 25 }), {
      total: 26, page: 2, limit: 25, totalPages: 2,
    });
  });
});
