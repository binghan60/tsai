// 登入後要回去的頁面來自網址上的 ?redirect=，那是誰都寫得進去的字串 ——
// 包括別人寄來的「請登入」連結。只接受站內路徑，其餘一律回首頁。
export function safeRedirectPath(raw) {
  // 同一個參數出現兩次時 vue-router 給的是陣列。
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !value.startsWith('/')) return '/';
  // `//host` 與 `/\host` 開頭是斜線，但瀏覽器會把它們當成另一個網域。
  if (value.startsWith('//') || value.startsWith('/\\')) return '/';
  // 登入完又回到登入頁只會原地打轉。
  if (/^\/login(?:[/?#]|$)/.test(value)) return '/';
  return value;
}
