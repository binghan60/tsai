import { Router } from 'express';
import { createAttemptLimiter } from '../lib/attemptLimiter.js';
import { clearSession, currentSession, isAuthEnabled, issueSession, passwordMatches } from '../config/adminAuth.js';

// 掛載於 /api/auth（公開路由：登入本身不能要求先登入）
const router = Router();

// 同一個 IP 15 分鐘內最多錯 10 次。密碼只有一組、沒有帳號可以鎖，所以鎖的是來源。
const loginAttempts = createAttemptLimiter({ max: 10, windowMs: 15 * 60 * 1000 });

// 前端開場先問這支，決定要顯示後台還是登入頁。一律回 200 ——
// 「還沒登入」是正常狀態，不是錯誤。
router.get('/session', (req, res) => {
  const authRequired = isAuthEnabled();
  res.set('Cache-Control', 'no-store');
  res.json({ authRequired, authenticated: !authRequired || Boolean(currentSession(req)) });
});

router.post('/login', (req, res) => {
  if (!isAuthEnabled()) return res.json({ authRequired: false, authenticated: true });

  // 被擋下的期間連正確的密碼也不受理，否則這個限制對猜密碼的人毫無作用。
  const retryAfter = loginAttempts.retryAfterSeconds(req.ip);
  if (retryAfter > 0) {
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ message: `密碼錯誤次數過多，請 ${Math.ceil(retryAfter / 60)} 分鐘後再試` });
  }

  if (!passwordMatches(req.body?.password)) {
    loginAttempts.recordFailure(req.ip);
    return res.status(401).json({ message: '密碼不正確' });
  }

  loginAttempts.reset(req.ip);
  issueSession(res);
  return res.json({ authRequired: true, authenticated: true });
});

router.post('/logout', (req, res) => {
  clearSession(res);
  res.status(204).end();
});

export default router;
