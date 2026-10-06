import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_COOKIE,
  assertAdminAuthConfigured,
  isAuthEnabled,
  issueSession,
  passwordMatches,
  requireAuth,
} from './adminAuth.js';

// 這裡釘住的是「後台到底有沒有設防」。最危險的壞法不是登不進去，
// 而是設定漏了卻照常運作 —— 所以正式環境沒密碼就該讓服務起不來。

const ENV_KEYS = ['ADMIN_PASSWORD', 'NODE_ENV', 'PUBLIC_APP_URL', 'CLIENT_ORIGIN', 'ZEABUR_WEB_URL'];
const DAY = 24 * 60 * 60 * 1000;
let saved;

const realWarn = console.warn;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  console.warn = () => {};
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  console.warn = realWarn;
});

// 只做 requireAuth／issueSession 會碰到的那幾樣。
function fakeResponse() {
  const res = { statusCode: 200, body: undefined, cookies: [] };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  res.cookie = (name, value, options) => {
    res.cookies.push({ name, value, options });
    return res;
  };
  return res;
}

const requestWithCookie = (value) => ({ headers: value ? { cookie: `${SESSION_COOKIE}=${value}` } : {} });

function sessionIssuedAt(now) {
  const res = fakeResponse();
  issueSession(res, now);
  return res.cookies[0].value;
}

function runRequireAuth(req) {
  const res = fakeResponse();
  let passed = false;
  requireAuth(req, res, () => {
    passed = true;
  });
  return { res, passed };
}

describe('isAuthEnabled', () => {
  it('沒設定或只有空白都算沒啟用', () => {
    assert.equal(isAuthEnabled(), false);
    process.env.ADMIN_PASSWORD = '   ';
    assert.equal(isAuthEnabled(), false);
  });

  it('有密碼就啟用', () => {
    process.env.ADMIN_PASSWORD = 'secret';
    assert.equal(isAuthEnabled(), true);
  });
});

describe('assertAdminAuthConfigured', () => {
  it('正式環境沒設密碼就丟例外，訊息點名該設哪個變數', () => {
    process.env.NODE_ENV = 'production';
    assert.throws(() => assertAdminAuthConfigured(), /ADMIN_PASSWORD/);
  });

  it('正式環境只填空白也一樣擋下', () => {
    process.env.NODE_ENV = 'production';
    process.env.ADMIN_PASSWORD = '  ';
    assert.throws(() => assertAdminAuthConfigured(), /ADMIN_PASSWORD/);
  });

  it('正式環境有密碼就放行', () => {
    process.env.NODE_ENV = 'production';
    process.env.ADMIN_PASSWORD = 'secret';
    assert.equal(assertAdminAuthConfigured(), true);
  });

  it('開發環境沒設密碼只提醒，不擋啟動', () => {
    const warnings = [];
    console.warn = (message) => warnings.push(message);
    assert.equal(assertAdminAuthConfigured(), false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /ADMIN_PASSWORD/);
  });
});

describe('passwordMatches', () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = 'correct horse';
  });

  it('只有完全相同的密碼才算對', () => {
    assert.equal(passwordMatches('correct horse'), true);
    assert.equal(passwordMatches('correct hors'), false);
    assert.equal(passwordMatches('Correct horse'), false);
    assert.equal(passwordMatches(''), false);
  });

  // 貼進平台變數欄位時多帶的換行，不該讓人拿著正確的密碼卻登不進去。
  it('兩邊的頭尾空白都不算數', () => {
    process.env.ADMIN_PASSWORD = '  correct horse\n';
    assert.equal(passwordMatches('correct horse '), true);
  });

  it('不是字串的輸入一律不符', () => {
    for (const value of [undefined, null, 123, {}, ['correct horse']]) {
      assert.equal(passwordMatches(value), false);
    }
  });

  it('沒啟用登入時不會有任何密碼被當成正確', () => {
    delete process.env.ADMIN_PASSWORD;
    assert.equal(passwordMatches(''), false);
  });
});

describe('requireAuth', () => {
  it('沒啟用登入時直接放行', () => {
    const { res, passed } = runRequireAuth(requestWithCookie(''));
    assert.equal(passed, true);
    assert.equal(res.statusCode, 200);
  });

  it('沒帶 cookie 回 401，並帶上前端用來辨識的 code', () => {
    process.env.ADMIN_PASSWORD = 'secret';
    const { res, passed } = runRequireAuth(requestWithCookie(''));
    assert.equal(passed, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'AUTH_REQUIRED');
  });

  it('帶著有效的 cookie 就放行，而且不必每次都換發', () => {
    process.env.ADMIN_PASSWORD = 'secret';
    const { res, passed } = runRequireAuth(requestWithCookie(sessionIssuedAt(Date.now())));
    assert.equal(passed, true);
    assert.equal(res.cookies.length, 0);
  });

  // 「有在用就不會過期」靠的是這一步。
  it('權杖簽發超過一天就順手換發一張新的', () => {
    process.env.ADMIN_PASSWORD = 'secret';
    const oldToken = sessionIssuedAt(Date.now() - 2 * DAY);
    const { res, passed } = runRequireAuth(requestWithCookie(oldToken));
    assert.equal(passed, true);
    assert.equal(res.cookies.length, 1);
    assert.equal(res.cookies[0].name, SESSION_COOKIE);
    assert.notEqual(res.cookies[0].value, oldToken);
  });

  it('超過 30 天沒用的權杖失效', () => {
    process.env.ADMIN_PASSWORD = 'secret';
    const { passed, res } = runRequireAuth(requestWithCookie(sessionIssuedAt(Date.now() - 31 * DAY)));
    assert.equal(passed, false);
    assert.equal(res.statusCode, 401);
  });

  it('改了密碼之後，舊密碼時期簽發的 cookie 全部失效', () => {
    process.env.ADMIN_PASSWORD = 'old-secret';
    const token = sessionIssuedAt(Date.now());
    process.env.ADMIN_PASSWORD = 'new-secret';
    const { passed, res } = runRequireAuth(requestWithCookie(token));
    assert.equal(passed, false);
    assert.equal(res.statusCode, 401);
  });
});

describe('登入 cookie 的屬性', () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = 'secret';
  });

  function issuedOptions() {
    const res = fakeResponse();
    issueSession(res);
    return res.cookies[0].options;
  }

  it('JavaScript 讀不到，也不隨跨站請求送出', () => {
    const options = issuedOptions();
    assert.equal(options.httpOnly, true);
    assert.equal(options.sameSite, 'lax');
    assert.equal(options.path, '/');
    assert.equal(options.maxAge, 30 * DAY);
  });

  it('對外網址是 https 時只走加密連線', () => {
    process.env.PUBLIC_APP_URL = 'https://clinic.example.com';
    assert.equal(issuedOptions().secure, true);
  });

  // 本機開發是 http://localhost，標了 Secure 的 cookie 部分瀏覽器不會存。
  it('對外網址是 http 或沒設定時不標 Secure', () => {
    assert.equal(issuedOptions().secure, false);
    process.env.CLIENT_ORIGIN = 'http://localhost:5173';
    assert.equal(issuedOptions().secure, false);
  });
});
