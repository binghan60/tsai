// 失敗次數限制：同一個來源在一段時間內失敗太多次，就暫時不再受理。
//
// 狀態放在記憶體。這套系統是單一容器，不需要跨程序共用；重啟後歸零也無妨 ——
// 重啟一次要花的時間，遠比這段期間能多猜的次數值錢。
//
// 視窗從第一次失敗起算，到期整筆清掉，不是滑動視窗：猜密碼的人不會因為
// 「一直試」而把自己的鎖定期往後延，但也拿不到比 max 更多的機會。
export function createAttemptLimiter({ max, windowMs, maxEntries = 10_000 }) {
  const entries = new Map();

  function current(key, now) {
    const entry = entries.get(key);
    if (!entry) return null;
    if (entry.resetAt <= now) {
      entries.delete(key);
      return null;
    }
    return entry;
  }

  // 來源是呼叫端給的字串（IP），數量不受我們控制。到上限時先清過期的，
  // 還是滿就丟掉最舊的一筆，記憶體用量才有個頂。
  function makeRoom(now) {
    if (entries.size < maxEntries) return;
    for (const [key, entry] of entries) {
      if (entry.resetAt <= now) entries.delete(key);
    }
    if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
  }

  return {
    // 還要等幾秒才能再試；0 表示沒有被擋。
    retryAfterSeconds(key, now = Date.now()) {
      const entry = current(key, now);
      if (!entry || entry.count < max) return 0;
      return Math.ceil((entry.resetAt - now) / 1000);
    },

    recordFailure(key, now = Date.now()) {
      const entry = current(key, now);
      if (entry) {
        entry.count += 1;
        return;
      }
      makeRoom(now);
      entries.set(key, { count: 1, resetAt: now + windowMs });
    },

    reset(key) {
      entries.delete(key);
    },
  };
}
