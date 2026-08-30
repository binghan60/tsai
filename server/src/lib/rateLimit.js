// 給單一端點用的簡易記憶體內限流器。單機部署（沒有多實例），不需要
// Redis 之類的共用儲存；`now` 可注入方便測試，不必真的等待時間流逝。
export function createRateLimiter({ windowMs, max, now = Date.now }) {
  const hits = new Map();

  return function rateLimiter(req, res, next) {
    const key = req.ip;
    const current = now();

    for (const [ip, entry] of hits) {
      if (entry.resetAt <= current) hits.delete(ip);
    }

    const entry = hits.get(key) ?? { count: 0, resetAt: current + windowMs };
    entry.count += 1;
    hits.set(key, entry);

    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - current) / 1000)));
      return res.status(429).json({ message: '嘗試次數過多，請稍後再試' });
    }
    return next();
  };
}
