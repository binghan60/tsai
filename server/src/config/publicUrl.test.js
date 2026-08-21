import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { assertAppOriginConfigured, configuredAppOrigin, publicAppOrigin } from './publicUrl.js';

// 這裡測的是「寄給飼主的信裡會出現哪個網域」。這個值錯掉的後果不是頁面壞掉，
// 而是一封由診所 Gmail 寄出、卻連往別人網站的健檢報告 —— 而且是安靜地寄出去，
// 沒有任何一步會失敗。所以正式環境沒設定就該讓服務起不來，這幾條就是釘住那個行為。

const ENV_KEYS = ['PUBLIC_APP_URL', 'CLIENT_ORIGIN', 'ZEABUR_WEB_URL', 'NODE_ENV'];
let saved;

// 這個模組會對可疑設定發出提醒，測試不需要看到那些字。
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

// 只用得到 publicAppOrigin 會讀的那幾樣東西。
const fakeRequest = (headers = {}, protocol = 'http') => ({
  protocol,
  get: (name) => headers[name.toLowerCase()],
});

describe('configuredAppOrigin', () => {
  it('沒有任何設定時回空字串', () => {
    assert.equal(configuredAppOrigin(), '');
  });

  it('PUBLIC_APP_URL 優先於其他兩個', () => {
    process.env.PUBLIC_APP_URL = 'https://clinic.example.com';
    process.env.CLIENT_ORIGIN = 'https://localhost:5173';
    process.env.ZEABUR_WEB_URL = 'https://zeabur.example.com';
    assert.equal(configuredAppOrigin(), 'https://clinic.example.com');
  });

  it('PUBLIC_APP_URL 沒設定時退到 CLIENT_ORIGIN，再退到 ZEABUR_WEB_URL', () => {
    process.env.CLIENT_ORIGIN = 'https://client.example.com';
    process.env.ZEABUR_WEB_URL = 'https://zeabur.example.com';
    assert.equal(configuredAppOrigin(), 'https://client.example.com');

    delete process.env.CLIENT_ORIGIN;
    assert.equal(configuredAppOrigin(), 'https://zeabur.example.com');
  });

  it('空白字串等於沒設定，不會擋住後面的來源', () => {
    process.env.PUBLIC_APP_URL = '   ';
    process.env.CLIENT_ORIGIN = 'https://client.example.com';
    assert.equal(configuredAppOrigin(), 'https://client.example.com');
  });

  it('結尾斜線與路徑都會被去掉', () => {
    process.env.PUBLIC_APP_URL = 'https://clinic.example.com/';
    assert.equal(configuredAppOrigin(), 'https://clinic.example.com');

    // 前端掛在網域根目錄，帶路徑組不出正確的 /report/:token
    process.env.PUBLIC_APP_URL = 'https://clinic.example.com/app?x=1';
    assert.equal(configuredAppOrigin(), 'https://clinic.example.com');
  });

  it('沒帶協定的設定值補成 https', () => {
    process.env.PUBLIC_APP_URL = 'clinic.example.com';
    assert.equal(configuredAppOrigin(), 'https://clinic.example.com');
  });

  it('保留非預設連接埠', () => {
    process.env.PUBLIC_APP_URL = 'http://localhost:8080';
    assert.equal(configuredAppOrigin(), 'http://localhost:8080');
  });

  // 打錯字不能被當成「沒設定」而悄悄退回 Host 推斷 —— 那正是要防的情況。
  it('不合法的網址直接丟例外，不會被當成沒設定', () => {
    process.env.PUBLIC_APP_URL = 'https://';
    assert.throws(() => configuredAppOrigin(), /PUBLIC_APP_URL/);
  });
});

describe('assertAppOriginConfigured', () => {
  it('正式環境沒設定就丟例外（啟動時會讓服務起不來）', () => {
    process.env.NODE_ENV = 'production';
    assert.throws(() => assertAppOriginConfigured(), /PUBLIC_APP_URL/);
  });

  it('正式環境有設定就回傳該網域', () => {
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_APP_URL = 'https://clinic.example.com';
    assert.equal(assertAppOriginConfigured(), 'https://clinic.example.com');
  });

  it('開發環境沒設定只提醒，不擋啟動', () => {
    assert.equal(assertAppOriginConfigured(), '');
  });
});

describe('publicAppOrigin', () => {
  it('有設定時完全不看請求標頭', () => {
    process.env.PUBLIC_APP_URL = 'https://clinic.example.com';
    const req = fakeRequest({ host: 'attacker.example.net', 'x-forwarded-host': 'attacker.example.net' });
    assert.equal(publicAppOrigin(req), 'https://clinic.example.com');
  });

  it('開發環境沒設定時才從請求推斷', () => {
    assert.equal(publicAppOrigin(fakeRequest({ host: 'localhost:3000' })), 'http://localhost:3000');
  });

  it('開發環境的推斷會採用 x-forwarded-* 的第一段', () => {
    const req = fakeRequest({
      host: 'localhost:3000',
      'x-forwarded-host': 'tunnel.example.com, proxy.internal',
      'x-forwarded-proto': 'https, http',
    });
    assert.equal(publicAppOrigin(req), 'https://tunnel.example.com');
  });

  it('正式環境沒設定時寧可失敗，也不從 Host 推斷', () => {
    process.env.NODE_ENV = 'production';
    const req = fakeRequest({ host: 'attacker.example.net' });
    assert.throws(() => publicAppOrigin(req), (err) => err.code === 'PUBLIC_URL_NOT_CONFIGURED');
  });
});
