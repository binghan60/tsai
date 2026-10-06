import crypto from 'crypto';

// 飼主開啟報告連結與 PDF 的密碼：飼主手機（owners.phone）的後 6 碼。
// 不另外存一個欄位——飼主改了電話，密碼就跟著變，院方也不必記「當初設了什麼」。
// 舊系統匯入的「手機」可能是市話，一樣取數字的後 6 碼；湊不滿 6 碼（沒填、填錯）就沒有密碼，
// 回傳空字串，呼叫端照「不設密碼」處理，才不會出現一份誰都打不開的報告。
export const REPORT_PASSCODE_LENGTH = 6;

export function reportPasscode(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= REPORT_PASSCODE_LENGTH ? digits.slice(-REPORT_PASSCODE_LENGTH) : '';
}

// 固定時間比對；飼主輸入時可能夾空白或連字號，只看數字。
export function reportPasscodeMatches(supplied, expected) {
  if (!expected) return true;
  const suppliedBuffer = Buffer.from(String(supplied ?? '').replace(/\D/g, ''));
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
}

// 只算「打錯」的次數，打對不算——飼主重新整理頁面不該被擋。
// 以分享連結為單位而不是 IP：6 碼數字只有一百萬種，換 IP 就能繞過的限制擋不住逐一嘗試。
export function createFailureLimiter({ windowMs, max, now = Date.now }) {
  const failures = new Map();

  function entryFor(key) {
    const current = now();
    for (const [storedKey, entry] of failures) {
      if (entry.resetAt <= current) failures.delete(storedKey);
    }
    return failures.get(key) ?? null;
  }

  return {
    // 被擋住時回傳還要等幾秒，否則 0。
    retryAfterSeconds(key) {
      const entry = entryFor(key);
      if (!entry || entry.count < max) return 0;
      return Math.ceil((entry.resetAt - now()) / 1000);
    },
    fail(key) {
      const entry = entryFor(key) ?? { count: 0, resetAt: now() + windowMs };
      entry.count += 1;
      failures.set(key, entry);
    },
  };
}
