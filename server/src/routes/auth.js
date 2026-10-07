import { Router } from 'express';
import { createAttemptLimiter, describeWait } from '../lib/attemptLimiter.js';
import { clearSession, currentSession, isAuthEnabled, issueSession, passwordMatches } from '../config/adminAuth.js';

// 掛載於 /api/auth（公開路由：登入本身不能要求先登入）
const router = Router();

// 同一個 IP 一天內累計錯 3 次，就從第 3 次起鎖 1 天。密碼只有一組、沒有帳號可以鎖，所以鎖的是來源。
// 累計期間也是一天：設得比鎖定短的話，每個期間只錯兩次就永遠不會被鎖。
// 鎖定記在記憶體，重啟服務就解除 —— 自己被鎖在外面時，那是唯一的解法。
const MAX_LOGIN_FAILURES = 3;
const LOGIN_LOCK_MS = 24 * 60 * 60 * 1000;
const loginAttempts = createAttemptLimiter({
  max: MAX_LOGIN_FAILURES,
  windowMs: LOGIN_LOCK_MS,
  lockMs: LOGIN_LOCK_MS,
});
const LOGIN_LOCK_LABEL = describeWait(LOGIN_LOCK_MS / 1000);

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
    return res.status(429).json({
      message: `此 IP 位址已鎖定，請於 ${describeWait(retryAfter)}後再試`,
      locked: true,
    });
  }

  // 前端把 warning 與 locked 畫成跟一般錯誤不同的樣子（LoginForm.vue），所以分欄位給，不併進 message。
  if (!passwordMatches(req.body?.password)) {
    const remaining = loginAttempts.recordFailure(req.ip);
    if (remaining > 0) {
      // 鎖一天的代價不小，要在還來得及的時候講，不能等鎖上了才知道。
      return res.status(401).json({
        message: '密碼不正確',
        warning: `剩餘嘗試次數：${remaining} 次。累計錯誤達 ${MAX_LOGIN_FAILURES} 次時，此 IP 位址將鎖定 ${LOGIN_LOCK_LABEL}。`,
      });
    }
    // 留一筆 log：被鎖的若是代理的位址而不是用戶端的，所有人會一起被擋，要看得出來。
    console.warn(`[auth] 密碼錯誤達 ${MAX_LOGIN_FAILURES} 次，鎖定來源 ${req.ip} ${LOGIN_LOCK_LABEL}`);
    return res.status(401).json({
      message: `密碼錯誤已達 ${MAX_LOGIN_FAILURES} 次，此 IP 位址已鎖定 ${LOGIN_LOCK_LABEL}`,
      locked: true,
    });
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
