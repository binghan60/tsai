import jwt from 'jsonwebtoken';
import { authEnabled, jwtSecret } from '../config/auth.js';
import User from '../models/User.js';

export const SESSION_COOKIE = 'clinic_token';
const TOKEN_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function cookieValue(req) {
  const entry = String(req.headers.cookie ?? '').split(';').find((item) => item.trim().startsWith(`${SESSION_COOKIE}=`));
  return entry ? entry.trim().slice(SESSION_COOKIE.length + 1) : '';
}

function cookieOptions(maxAge = TOKEN_MAX_AGE_SECONDS) {
  return ['Path=/', 'HttpOnly', 'SameSite=Strict', process.env.NODE_ENV === 'production' ? 'Secure' : '', `Max-Age=${maxAge}`]
    .filter(Boolean).join('; ');
}

export function createSessionCookie(user) {
  const token = jwt.sign(
    { username: user.username, tokenVersion: user.tokenVersion },
    jwtSecret(),
    { algorithm: 'HS256', subject: String(user._id), expiresIn: TOKEN_MAX_AGE_SECONDS },
  );
  return `${SESSION_COOKIE}=${token}; ${cookieOptions()}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; ${cookieOptions(0)}`;
}

// 每次驗證都多查一次 DB，用意是讓「改密碼」「停用帳號」「revoke-sessions 腳本」
// 能立即生效，而不是得等 JWT 自然過期——純看 JWT 簽章本身沒有辦法撤銷。
// 診所單一帳號的流量，多這次查詢的成本可以忽略。
export async function sessionUser(req) {
  if (!authEnabled()) return { _id: 'development-bypass', username: 'development' };
  const token = cookieValue(req);
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] });
  } catch {
    return null;
  }
  if (
    typeof payload !== 'object' ||
    typeof payload.sub !== 'string' ||
    typeof payload.username !== 'string' ||
    typeof payload.tokenVersion !== 'number'
  ) {
    return null;
  }
  const user = await User.findById(payload.sub);
  if (!user || !user.active || user.tokenVersion !== payload.tokenVersion) return null;
  return { _id: String(user._id), username: user.username };
}
