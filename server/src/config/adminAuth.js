import crypto from 'node:crypto';
import { configuredAppOrigin } from './publicUrl.js';
import { createSessionToken, readCookie, verifySessionToken } from '../lib/session.js';

// 後台登入。單人使用，所以只有一組密碼，放在環境變數 ADMIN_PASSWORD，不進資料庫。
//
// 沒設密碼＝不啟用登入。這只允許出現在開發與測試：正式環境漏設時由
// assertAdminAuthConfigured() 在啟動當下擋掉，理由跟 PUBLIC_APP_URL 一樣 ——
// 「不設防卻照常運作」是最難被發現的一種壞法。

export const SESSION_COOKIE = 'clinic_session';

// 30 天沒開才需要重新登入；有在用就會在背景換發，等於不會過期。
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// 不必每個請求都換發。一天換一次，權杖的到期日最多只比「最後使用時間 + 30 天」早一天。
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;

// 頭尾空白不算密碼的一部分：從別處複製貼上到平台的變數欄位時很容易多帶一個換行，
// 那會讓人拿著「正確的密碼」卻怎麼都登不進去。登入時輸入的值也做同樣處理。
function adminPassword() {
  return (process.env.ADMIN_PASSWORD ?? '').trim();
}

export function isAuthEnabled() {
  return adminPassword() !== '';
}

// 啟動時呼叫：正式環境沒設定就讓服務起不來。
export function assertAdminAuthConfigured() {
  if (isAuthEnabled()) return true;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '正式環境必須設定 ADMIN_PASSWORD：沒有它後台就完全不設防，'
      + '任何知道網址的人都能讀寫全部資料、並用診所的信箱寄信。'
    );
  }
  console.warn('[auth] 未設定 ADMIN_PASSWORD，後台不需要登入（僅限開發）');
  return false;
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest();
}

// 先各自雜湊成等長再比：timingSafeEqual 要求長度相同，而直接比長度會洩漏密碼有多長。
export function passwordMatches(input) {
  if (!isAuthEnabled() || typeof input !== 'string') return false;
  return crypto.timingSafeEqual(digest(input.trim()), digest(adminPassword()));
}

// 簽章金鑰從密碼衍生，不另外要一個環境變數。兩個好處：部署時少一樣會漏設的東西；
// 改密碼等於換金鑰，所有裝置上的舊登入會一起失效。
// 用 scrypt 而不是直接雜湊：萬一某張 cookie 外流，也沒辦法拿它的簽章離線快速猜密碼。
// 衍生一次要幾十毫秒，所以結果留著，密碼變了才重算。
let derived = { password: null, key: null };
function sessionKey() {
  const password = adminPassword();
  if (derived.password !== password) {
    derived = { password, key: crypto.scryptSync(password, 'tsai-session-key-v1', 32) };
  }
  return derived.key;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    // 看設定好的對外網址，不看這次請求的協定 —— 請求是經過平台的反向代理進來的，
    // 協定是代理轉述的；設定值才是伺服器自己知道的事實（同 publicUrl.js 的考量）。
    secure: configuredAppOrigin().startsWith('https://'),
  };
}

export function issueSession(res, now = Date.now()) {
  const token = createSessionToken({ key: sessionKey(), ttlMs: SESSION_TTL_MS, now });
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_TTL_MS });
}

export function clearSession(res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

export function currentSession(req, now = Date.now()) {
  if (!isAuthEnabled()) return null;
  return verifySessionToken(readCookie(req.headers?.cookie, SESSION_COOKIE), { key: sessionKey(), now });
}

// 掛在所有後台 API 之前。公開路由（健康檢查、登入、飼主看報告）要掛在它「前面」，
// 放行名單就是 app.js 裡的掛載順序。
export function requireAuth(req, res, next) {
  if (!isAuthEnabled()) return next();
  const now = Date.now();
  const session = currentSession(req, now);
  if (!session) {
    // code 讓呼叫端不必靠訊息文字，就能認出這是被登入門禁擋下的。
    return res.status(401).json({ message: '請先登入', code: 'AUTH_REQUIRED' });
  }
  if (now - session.issuedAt > RENEW_AFTER_MS) issueSession(res, now);
  return next();
}
