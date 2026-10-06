import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionToken, readCookie, verifySessionToken } from './session.js';

const key = Buffer.alloc(32, 'k');
const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 1);

describe('session token', () => {
  it('到期前驗得過，並帶回簽發與到期時間', () => {
    const token = createSessionToken({ key, ttlMs: HOUR, now: NOW });
    assert.deepEqual(verifySessionToken(token, { key, now: NOW + HOUR - 1 }), {
      issuedAt: NOW,
      expiresAt: NOW + HOUR,
    });
  });

  it('到期的那一刻起失效', () => {
    const token = createSessionToken({ key, ttlMs: HOUR, now: NOW });
    assert.equal(verifySessionToken(token, { key, now: NOW + HOUR }), null);
  });

  // 權杖的內容是明文，誰都改得動；擋住竄改的只有簽章。
  it('把到期時間改晚會讓簽章對不上', () => {
    const [version, issued, , signature] = createSessionToken({ key, ttlMs: HOUR, now: NOW }).split('.');
    const forged = [version, issued, NOW + 365 * 24 * HOUR, signature].join('.');
    assert.equal(verifySessionToken(forged, { key, now: NOW }), null);
  });

  it('簽章被改動或截短都驗不過', () => {
    const token = createSessionToken({ key, ttlMs: HOUR, now: NOW });
    const flipped = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    assert.equal(verifySessionToken(flipped, { key, now: NOW }), null);
    assert.equal(verifySessionToken(token.slice(0, -4), { key, now: NOW }), null);
  });

  // 金鑰是從密碼衍生的，這條就是「改密碼會讓所有裝置登出」的依據。
  it('換了金鑰，舊權杖全部失效', () => {
    const token = createSessionToken({ key, ttlMs: HOUR, now: NOW });
    assert.equal(verifySessionToken(token, { key: Buffer.alloc(32, 'x'), now: NOW }), null);
  });

  it('不是權杖的東西一律回 null，不丟例外', () => {
    for (const value of [undefined, null, '', 'abc', 'v1.1.2', 'v2.1.2.sig', 'v1.a.b.c', {}]) {
      assert.equal(verifySessionToken(value, { key, now: NOW }), null);
    }
  });
});

describe('readCookie', () => {
  it('從多個 cookie 裡取出指定的那一個', () => {
    assert.equal(readCookie('theme=dark; clinic_session=abc.def; other=1', 'clinic_session'), 'abc.def');
  });

  it('值裡面有等號時不會被切斷', () => {
    assert.equal(readCookie('clinic_session=a=b=c', 'clinic_session'), 'a=b=c');
  });

  it('名稱要完全相同，不會被名字相近的 cookie 冒充', () => {
    assert.equal(readCookie('xclinic_session=evil; clinic_session_old=evil', 'clinic_session'), '');
  });

  it('沒有 Cookie 標頭或找不到時回空字串', () => {
    assert.equal(readCookie(undefined, 'clinic_session'), '');
    assert.equal(readCookie('theme=dark', 'clinic_session'), '');
  });
});
