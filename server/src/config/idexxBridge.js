import crypto from 'crypto';

// 診所電腦上的抓檔程式（把 IDEXX InterLink 存下的檔案上傳到系統）用這把密鑰驗證身分。
// 它不是人、不會登入，所以不走網頁的 cookie；密鑰放在 Authorization: Bearer 標頭。
// 沒設定（或太短）就整個關閉——忘了設的時候寧可收不到，也不能變成任何人都能往系統裡丟檔案。
const MIN_TOKEN_LENGTH = 32;

export function idexxBridgeConfigured() {
  return (process.env.IDEXX_BRIDGE_TOKEN ?? '').length >= MIN_TOKEN_LENGTH;
}

// 報到時要不要把貓咪送到 IDEXX 主機（lib/idexxCensus.js）。預設關閉：要到診所跟 IDEXX 的人一起確認後才打開。
//   IDEXX_CENSUS_MODE      off（預設）／census／work_request——兩種訊息哪一種在 IDEXX 主機上比較順，要現場試
//   IDEXX_CENSUS_ENCODING  big5（預設，IDEXX 範例的編碼）／utf-8——中文貓名在主機上亂碼就換另一種
export const IDEXX_CENSUS_MODES = ['off', 'census', 'work_request'];

export function idexxCensusSettings(env = process.env) {
  const mode = String(env.IDEXX_CENSUS_MODE ?? '').trim().toLowerCase();
  return {
    mode: IDEXX_CENSUS_MODES.includes(mode) ? mode : 'off',
    encoding: /^utf-?8$/i.test(String(env.IDEXX_CENSUS_ENCODING ?? '').trim()) ? 'utf-8' : 'big5',
  };
}

export function hasIdexxBridgeAccess(req) {
  if (!idexxBridgeConfigured()) return false;
  const supplied = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '')?.[1];
  if (!supplied) return false;
  const expectedBuffer = Buffer.from(process.env.IDEXX_BRIDGE_TOKEN);
  const suppliedBuffer = Buffer.from(supplied);
  return suppliedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
}
