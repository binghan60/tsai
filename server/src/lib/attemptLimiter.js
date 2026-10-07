// 失敗次數限制：同一個來源在一段時間內失敗太多次，就暫時不再受理。
//
// 狀態放在記憶體。這套系統是單一容器，不需要跨程序共用；重啟後歸零也無妨 ——
// 重啟一次要花的時間，遠比這段期間能多猜的次數值錢。
//
// 兩段時間分開算：
// - windowMs 是累計失敗的期間，從第一次失敗起算，到期整筆清掉，不是滑動視窗。
// - lockMs 是達到上限後擋多久，從達到上限的那一次起算（沒給就跟 windowMs 一樣長）。
//   不從第一次失敗起算，是因為失敗若分散在視窗頭尾，鎖定會只剩視窗的零頭。
// 鎖定期間繼續失敗不會把解鎖時間往後推，但也拿不到比 max 更多的機會。
export function createAttemptLimiter({ max, windowMs, lockMs = windowMs, maxEntries = 10_000 }) {
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

    // 回傳被擋之前還能再失敗幾次；0 表示這一次之後就擋下了。
    recordFailure(key, now = Date.now()) {
      let entry = current(key, now);
      if (!entry) {
        makeRoom(now);
        entry = { count: 0, resetAt: now + windowMs };
        entries.set(key, entry);
      }
      entry.count += 1;
      // 只有剛好達到上限的那一次起算鎖定，之後的失敗不再動它。
      if (entry.count === max) entry.resetAt = now + lockMs;
      return Math.max(max - entry.count, 0);
    },

    reset(key) {
      entries.delete(key);
    },
  };
}

// 把等待秒數寫成給人看的字。無條件進位到分鐘 —— 寧可叫人多等幾秒，
// 也不要照著提示的時間回來卻還是被擋。
export function describeWait(seconds) {
  const minutes = Math.max(Math.ceil(seconds / 60), 1);
  if (minutes < 60) return `${minutes} 分鐘`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小時 ${rest} 分鐘` : `${hours} 小時`;
}
