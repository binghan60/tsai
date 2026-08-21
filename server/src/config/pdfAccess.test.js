import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasPdfRenderAccess, pdfAccessSecret } from './pdfAccess.js';

const requestWithHeader = (value) => ({
  get: (name) => (name.toLowerCase() === 'x-pdf-render-secret' ? value : undefined),
});

describe('hasPdfRenderAccess', () => {
  it('accepts the renderer credential supplied through an HTTP header', () => {
    assert.equal(hasPdfRenderAccess(requestWithHeader(pdfAccessSecret)), true);
  });

  it('rejects missing, short and incorrect credentials', () => {
    assert.equal(hasPdfRenderAccess(requestWithHeader()), false);
    assert.equal(hasPdfRenderAccess(requestWithHeader('short')), false);
    assert.equal(hasPdfRenderAccess(requestWithHeader(`${pdfAccessSecret}-wrong`)), false);
  });
});
