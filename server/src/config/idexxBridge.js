import crypto from 'crypto';

// 診所電腦上的抓檔程式（把 IDEXX InterLink 存下的檔案上傳到系統）用這把密鑰驗證身分。
// 它不是人、不會登入，所以不走網頁的 cookie；密鑰放在 Authorization: Bearer 標頭。
// 沒設定（或太短）就整個關閉——忘了設的時候寧可收不到，也不能變成任何人都能往系統裡丟檔案。
const MIN_TOKEN_LENGTH = 32;

export function idexxBridgeConfigured() {
  return (process.env.IDEXX_BRIDGE_TOKEN ?? '').length >= MIN_TOKEN_LENGTH;
}

export function hasIdexxBridgeAccess(req) {
  if (!idexxBridgeConfigured()) return false;
  const supplied = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '')?.[1];
  if (!supplied) return false;
  const expectedBuffer = Buffer.from(process.env.IDEXX_BRIDGE_TOKEN);
  const suppliedBuffer = Buffer.from(supplied);
  return suppliedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
}
