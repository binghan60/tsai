import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { app } from '../app.js';
import User from '../models/User.js';

function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(password, Buffer.from(salt, 'base64url'), 64).toString('base64url');
  return `scrypt$${salt}$${hash}`;
}

describe('shared clinic authentication', () => {
  let server;
  let origin;
  const user = { _id: 'user-1', username: 'clinic', active: true, tokenVersion: 0, passwordHash: passwordHash('test-password') };
  const originalFindOne = User.findOne;
  const originalFindById = User.findById;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const saved = Object.fromEntries(['AUTH_ENABLED', 'AUTH_USERNAME', 'AUTH_PASSWORD_HASH', 'JWT_SECRET'].map((key) => [key, process.env[key]]));

  before(async () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-hs256';
    delete process.env.AUTH_USERNAME;
    delete process.env.AUTH_PASSWORD_HASH;
    User.findOne = ({ username }) => ({ select: async () => (username === user.username ? user : null) });
    User.findById = async (id) => (id === String(user._id) ? user : null);
    User.findOneAndUpdate = async ({ username }, update) => {
      if (username !== user.username) return null;
      user.tokenVersion += update.$inc.tokenVersion;
      return user;
    };
    server = app.listen(0, '127.0.0.1');
    if (!server.listening) await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    User.findOne = originalFindOne;
    User.findById = originalFindById;
    User.findOneAndUpdate = originalFindOneAndUpdate;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it('protects internal APIs and issues a signed JWT HttpOnly cookie after login', async () => {
    const denied = await fetch(`${origin}/api/owners`);
    assert.equal(denied.status, 401);

    const rejectedLogin = await fetch(`${origin}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'clinic', password: 'wrong' }),
    });
    assert.equal(rejectedLogin.status, 401);

    const loggedIn = await fetch(`${origin}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'clinic', password: 'test-password' }),
    });
    assert.equal(loggedIn.status, 200);
    const cookie = loggedIn.headers.get('set-cookie');
    assert.match(cookie, /clinic_token=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);

    const authenticated = await fetch(`${origin}/api/auth/me`, { headers: { cookie } });
    assert.equal(authenticated.status, 200);
    assert.deepEqual(await authenticated.json(), { authenticated: true, enabled: true, username: 'clinic' });

    const loggedOut = await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers: { cookie } });
    assert.equal(loggedOut.status, 204);
    assert.match(loggedOut.headers.get('set-cookie'), /Max-Age=0/);
    const unauthenticated = await fetch(`${origin}/api/auth/me`);
    assert.equal(unauthenticated.status, 401);
  });

  it('revoking sessions (e.g. via the set-password/revoke-sessions scripts) invalidates existing cookies immediately', async () => {
    const loggedIn = await fetch(`${origin}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'clinic', password: 'test-password' }),
    });
    const cookie = loggedIn.headers.get('set-cookie');

    const stillValid = await fetch(`${origin}/api/auth/me`, { headers: { cookie } });
    assert.equal(stillValid.status, 200);

    await User.findOneAndUpdate({ username: 'clinic' }, { $inc: { tokenVersion: 1 } });

    const revoked = await fetch(`${origin}/api/auth/me`, { headers: { cookie } });
    assert.equal(revoked.status, 401);
  });
});
