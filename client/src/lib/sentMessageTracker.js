// 全站未讀提示（側邊欄「看診」／「櫃台」徽章）跟「發留言的那個頁面」是分開的，
// 不知道目前這台裝置算醫生還是櫃台（身分是頁面固定的，不是全域狀態），沒辦法
// 用身分判斷「這則是不是我自己剛發的」。改用留言 _id 追蹤：頁面送出成功後標記
// 一次，全站監聽收到 socket 廣播時比對，是自己剛送出的就不用再通知自己。
//
// 光靠「送出成功後才標記」還不夠：伺服器在回應這支 POST 之前還要多做一次
// ClinicalNote 同步，socket 廣播完全可能比 HTTP 回應先一步送達同一個瀏覽器
// （兩者是各自獨立的連線，沒有誰先誰後的保證）。若廣播先到，這時 _id 還沒標記，
// 自己剛送出的留言就會被誤判成「別人發的」，變成一則永遠清不掉的幽靈通知
// （因為送訊息的那一頁根本不會再去清另一個方向的未讀）。
// 解法：送出「之前」就先用「掛號＋身分＋內容」這組還原得出來的線索佔位，
// 等真正拿到留言 _id 後再补標一次精準的 id，佔位跟 id 都在 15 秒後過期。
const recentlySentMessageIds = new Set();
const pendingSends = new Set();
const EXPIRY_MS = 15_000;

function pendingKey(appointmentId, sender, content) {
  return `${appointmentId}::${sender}::${content}`;
}

export function markMessageSending(appointmentId, sender, content) {
  if (!appointmentId || !sender) return;
  const key = pendingKey(appointmentId, sender, content);
  pendingSends.add(key);
  setTimeout(() => pendingSends.delete(key), EXPIRY_MS);
}

export function markMessageAsSent(id) {
  if (!id) return;
  recentlySentMessageIds.add(id);
  setTimeout(() => recentlySentMessageIds.delete(id), EXPIRY_MS);
}

export function wasRecentlySent({ id, appointmentId, sender, content }) {
  if (id && recentlySentMessageIds.has(id)) return true;
  return Boolean(appointmentId && sender) && pendingSends.has(pendingKey(appointmentId, sender, content));
}
