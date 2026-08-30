import { Router } from 'express';
import { DUMMY_PASSWORD_HASH, authEnabled, verifyPassword } from '../config/auth.js';
import { clearSessionCookie, createSessionCookie, sessionUser } from '../lib/session.js';
import { createRateLimiter } from '../lib/rateLimit.js';
import User from '../models/User.js';

const router = Router();

// 這支路由對外免驗證，且只有一組共用帳密可以猜——沒有限流形同對外開放暴力破解。
const loginRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

router.get('/me', async (req, res, next) => {
  try {
    const user = await sessionUser(req);
    if (!user) return res.status(401).json({ message: '登入已失效' });
    return res.json({ authenticated: true, enabled: authEnabled(), username: user.username });
  } catch (error) {
    return next(error);
  }
});

router.post('/login', loginRateLimiter, async (req, res, next) => {
  try {
    if (!authEnabled()) return res.status(503).json({ message: '登入尚未啟用' });
    const username = String(req.body?.username ?? '').trim();
    const user = await User.findOne({ username, active: true }).select('+passwordHash');
    // 帳號不存在時仍對 DUMMY_PASSWORD_HASH 跑一次驗證，讓耗時跟帳號存在時一致，
    // 避免從回應時間差量出帳號是否存在。
    const passwordOk = await verifyPassword(req.body?.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !passwordOk) {
      return res.status(401).json({ message: '帳號或密碼錯誤' });
    }
    res.setHeader('Set-Cookie', createSessionCookie(user));
    return res.json({ authenticated: true, username: user.username });
  } catch (error) {
    return next(error);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    res.setHeader('Set-Cookie', clearSessionCookie());
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

export async function requireAuthentication(req, res, next) {
  try {
    const user = await sessionUser(req);
    if (!user) return res.status(401).json({ message: '請先登入' });
    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

export default router;
