import crypto from 'node:crypto';
import { promisify } from 'node:util';
import User from '../models/User.js';

const scrypt = promisify(crypto.scrypt);

// 帳號不存在時仍要跑一次等重量的 scrypt 運算，讓「帳號不存在」跟「密碼錯誤」
// 兩種回應耗時一致——否則帳號存在與否可以直接從回應時間差量出來。
// 值本身不必是真的雜湊，格式（scrypt$<22字元鹽>$<86字元雜湊>）對得上就行。
export const DUMMY_PASSWORD_HASH = `scrypt$${'A'.repeat(22)}$${'A'.repeat(86)}`;

const bootstrapUsername = () => process.env.AUTH_USERNAME?.trim() ?? '';
const bootstrapPasswordHash = () => process.env.AUTH_PASSWORD_HASH?.trim() ?? '';

export function authEnabled() {
  return process.env.AUTH_ENABLED === 'true' || process.env.NODE_ENV === 'production';
}

export function jwtSecret() {
  return process.env.JWT_SECRET ?? '';
}

export function assertJwtConfigured() {
  if (!authEnabled()) return;
  if (jwtSecret().length < 32) {
    const error = new Error('啟用登入時，必須設定至少 32 字元的 JWT_SECRET');
    error.code = 'JWT_SECRET_NOT_CONFIGURED';
    throw error;
  }
}

export function validPasswordHash(value) {
  return /^scrypt\$[^$]+\$[^$]+$/.test(value);
}

export async function verifyPassword(password, passwordHash) {
  const [algorithm, salt, expected] = String(passwordHash ?? '').split('$');
  if (algorithm !== 'scrypt' || !salt || !expected) return false;
  const actual = await scrypt(String(password ?? ''), Buffer.from(salt, 'base64url'), 64);
  const expectedBuffer = Buffer.from(expected, 'base64url');
  return expectedBuffer.length === actual.length && crypto.timingSafeEqual(expectedBuffer, actual);
}

export async function ensureBootstrapUser() {
  if (!authEnabled()) return;
  const existingUser = await User.exists({});
  if (existingUser) return;
  const username = bootstrapUsername();
  const passwordHash = bootstrapPasswordHash();
  if (!username || !validPasswordHash(passwordHash)) {
    throw new Error('首次啟用登入時，必須設定 AUTH_USERNAME 與有效的 AUTH_PASSWORD_HASH 來建立共用帳號');
  }
  await User.create({ username, passwordHash });
  console.log('[auth] 已建立初始共用診所帳號');
}
