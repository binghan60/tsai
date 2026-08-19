// 使用者輸入的關鍵字要當成字面字串比對，不是正規表達式。
// 沒有跳脫的話，搜尋「(」之類的字元會直接讓 RegExp 建構子丟例外。
export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
