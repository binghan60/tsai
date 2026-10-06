import crypto from 'node:crypto';

// 登入狀態的權杖。這裡只有純函式：金鑰與時間都由呼叫端傳入，不讀環境變數、
// 也不碰 req／res，測試才不必起伺服器。
//
// 伺服器不存 session —— 權杖自己帶著簽發與到期時間，用 HMAC 簽章防竄改。
// 單人使用的系統不需要一張 session 表，也因此重新部署不會把人登出。
// 代價是沒辦法單獨撤銷某一張權杖；要全部作廢就換密碼（金鑰是從密碼衍生的）。

const VERSION = 'v1';

function sign(payload, key) {
  return crypto.createHmac('sha256', key).update(payload).digest('base64url');
}

export function createSessionToken({ key, ttlMs, now = Date.now() }) {
  const payload = `${VERSION}.${now}.${now + ttlMs}`;
  return `${payload}.${sign(payload, key)}`;
}

// 驗證通過回傳 { issuedAt, expiresAt }，其餘一律回 null —— 呼叫端不需要知道
// 是格式錯、簽章錯還是過期，那些差別只對攻擊者有用。
export function verifySessionToken(token, { key, now = Date.now() }) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const [version, issuedText, expiresText, signature] = parts;

  const expected = Buffer.from(sign(`${version}.${issuedText}.${expiresText}`, key));
  const supplied = Buffer.from(signature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;

  const issuedAt = Number(issuedText);
  const expiresAt = Number(expiresText);
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)) return null;
  if (expiresAt <= now) return null;
  return { issuedAt, expiresAt };
}

// 從 Cookie 標頭取出單一 cookie 的值。Express 本身不解析請求的 cookie，
// 而我們只需要讀一個，不值得為此多裝一個套件。同名出現多次時以第一個為準。
export function readCookie(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return '';
}
