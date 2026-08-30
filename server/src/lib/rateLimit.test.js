import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from './rateLimit.js';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.setHeader = (key, value) => { res.headers[key] = value; };
  return res;
}

describe('createRateLimiter', () => {
  it('allows up to max requests per window then blocks with 429', () => {
    let now = 0;
    const limiter = createRateLimiter({ windowMs: 1000, max: 2, now: () => now });
    const req = { ip: '1.2.3.4' };
    let nextCalled = 0;
    const next = () => { nextCalled += 1; };

    limiter(req, mockRes(), next);
    limiter(req, mockRes(), next);
    assert.equal(nextCalled, 2);

    const blockedRes = mockRes();
    limiter(req, blockedRes, next);
    assert.equal(nextCalled, 2);
    assert.equal(blockedRes.statusCode, 429);
    assert.ok(Number(blockedRes.headers['Retry-After']) > 0);
  });

  it('resets once the window has passed', () => {
    let now = 0;
    const limiter = createRateLimiter({ windowMs: 1000, max: 1, now: () => now });
    const req = { ip: '5.6.7.8' };
    let nextCalled = 0;
    const next = () => { nextCalled += 1; };

    limiter(req, mockRes(), next);
    now = 1001;
    limiter(req, mockRes(), next);
    assert.equal(nextCalled, 2);
  });

  it('tracks each IP independently', () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1, now: () => 0 });
    let nextCalled = 0;
    const next = () => { nextCalled += 1; };

    limiter({ ip: 'a' }, mockRes(), next);
    limiter({ ip: 'b' }, mockRes(), next);
    assert.equal(nextCalled, 2);
  });
});
