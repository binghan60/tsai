import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { app } from '../app.js';
import MedicalRecord from '../models/MedicalRecord.js';

// 這裡測的是接線：哪些路由在門禁後面、哪些故意留在外面。
// 權杖與次數限制本身的邏輯各自有單元測試，這裡只確認它們真的被掛上去了。

const PASSWORD = 'correct horse battery staple';

describe('admin login', () => {
  let server;
  let origin;
  let previousPassword;

  before(async () => {
    previousPassword = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD = PASSWORD;
    server = app.listen(0, '127.0.0.1');
    if (!server.listening) await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousPassword;
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  const login = (password) => fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });

  // Set-Cookie 的第一段就是瀏覽器之後會送回來的 name=value。
  const cookieFrom = (response) => response.headers.getSetCookie()[0]?.split(';')[0] ?? '';

  async function loggedInCookie() {
    const response = await login(PASSWORD);
    assert.equal(response.status, 200);
    return cookieFrom(response);
  }

  it('rejects every admin route without a session', async () => {
    const requests = [
      ['GET', '/api/owners'],
      ['GET', '/api/pets'],
      ['GET', '/api/records'],
      ['GET', '/api/dashboard'],
      ['GET', '/api/search?q=a'],
      ['GET', '/api/delivery-logs'],
      ['GET', '/api/settings/form-templates'],
      ['GET', '/api/text-templates'],
      ['GET', '/api/records/record-1/pdf'],
      ['POST', '/api/records/record-1/send-email'],
      ['DELETE', '/api/records/record-1'],
    ];
    for (const [method, path] of requests) {
      const response = await fetch(`${origin}${path}`, { method });
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.equal((await response.json()).code, 'AUTH_REQUIRED', `${method} ${path}`);
    }
  });

  it('keeps health checks open so the container is not marked unhealthy', async () => {
    assert.equal((await fetch(`${origin}/api/health/live`)).status, 200);
    // 503 是因為測試沒連資料庫；重點是它不是 401。
    assert.equal((await fetch(`${origin}/api/health`)).status, 503);
  });

  // 飼主看報告與 Puppeteer 產 PDF 都走這條，擋到它等於分享連結與 PDF 一起壞掉。
  it('keeps the public report endpoint open for owners and the PDF renderer', async () => {
    const originalFindOne = MedicalRecord.findOne;
    MedicalRecord.findOne = () => ({ populate: async () => null });
    try {
      const response = await fetch(`${origin}/api/public/reports/some-share-token`);
      assert.equal(response.status, 404);
    } finally {
      MedicalRecord.findOne = originalFindOne;
    }
  });

  it('reports the session state without treating "not logged in" as an error', async () => {
    const anonymous = await fetch(`${origin}/api/auth/session`);
    assert.equal(anonymous.status, 200);
    assert.deepEqual(await anonymous.json(), { authRequired: true, authenticated: false });

    const cookie = await loggedInCookie();
    const authenticated = await fetch(`${origin}/api/auth/session`, { headers: { cookie } });
    assert.deepEqual(await authenticated.json(), { authRequired: true, authenticated: true });
  });

  it('refuses a wrong password, sets no cookie, and warns how many tries are left', async () => {
    // 先成功登入一次把計數歸零，訊息裡的剩餘次數才不受前面的測試影響。
    await loggedInCookie();
    const response = await login('not the password');
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      message: '密碼不正確',
      warning: '剩餘嘗試次數：2 次。累計錯誤達 3 次時，此 IP 位址將鎖定 24 小時。',
    });
    assert.deepEqual(response.headers.getSetCookie(), []);
  });

  it('issues an HttpOnly session cookie that unlocks the admin routes', async () => {
    const response = await login(PASSWORD);
    assert.equal(response.status, 200);
    const setCookie = response.headers.getSetCookie()[0];
    assert.match(setCookie, /^clinic_session=v1\./);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);

    // 428 是這支路由自己的檢查（缺版本號），代表請求已經通過門禁、進到原本的邏輯。
    const update = await fetch(`${origin}/api/owners/owner-1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: cookieFrom(response) },
      body: JSON.stringify({ name: '王小明', phone: '0912345678', email: '' }),
    });
    assert.equal(update.status, 428);
  });

  it('rejects a cookie whose expiry was edited', async () => {
    const [name, token] = (await loggedInCookie()).split('=');
    const [version, issued, , signature] = token.split('.');
    const forged = `${name}=${[version, issued, '99999999999999', signature].join('.')}`;
    const response = await fetch(`${origin}/api/owners`, { headers: { cookie: forged } });
    assert.equal(response.status, 401);
  });

  it('clears the cookie on logout', async () => {
    const response = await fetch(`${origin}/api/auth/logout`, { method: 'POST' });
    assert.equal(response.status, 204);
    const setCookie = response.headers.getSetCookie()[0];
    assert.match(setCookie, /^clinic_session=;/);
    assert.match(setCookie, /Expires=Thu, 01 Jan 1970/);
  });

  // 放最後：鎖定之後這個來源（127.0.0.1）在同一個程序裡就登不進去了。
  it('locks out the source for a day after three wrong passwords, even for the right one', async () => {
    // 先成功登入一次把計數歸零，前面測試留下的失敗次數才不會算進來。
    await loggedInCookie();
    assert.equal((await login('wrong')).status, 401);
    const second = await login('wrong');
    assert.equal(second.status, 401);
    assert.match((await second.json()).warning, /^剩餘嘗試次數：1 次/);
    const third = await login('wrong');
    assert.equal(third.status, 401);
    assert.deepEqual(await third.json(), { message: '密碼錯誤已達 3 次，此 IP 位址已鎖定 24 小時', locked: true });

    const blocked = await login(PASSWORD);
    assert.equal(blocked.status, 429);
    const retryAfter = Number(blocked.headers.get('retry-after'));
    assert.ok(retryAfter > 23 * 60 * 60 && retryAfter <= 24 * 60 * 60, `retry-after ${retryAfter}`);
    assert.deepEqual(await blocked.json(), { message: '此 IP 位址已鎖定，請於 24 小時後再試', locked: true });
    assert.deepEqual(blocked.headers.getSetCookie(), []);
  });
});

describe('admin login when no password is configured', () => {
  let server;
  let origin;
  let previousPassword;

  before(async () => {
    previousPassword = process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_PASSWORD;
    server = app.listen(0, '127.0.0.1');
    if (!server.listening) await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (previousPassword !== undefined) process.env.ADMIN_PASSWORD = previousPassword;
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  // 前端靠這個回應決定要不要顯示登入頁與登出鈕。
  it('tells the client that no login is needed', async () => {
    const response = await fetch(`${origin}/api/auth/session`);
    assert.deepEqual(await response.json(), { authRequired: false, authenticated: true });
  });
});
