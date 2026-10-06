// 後端的錯誤一律回 { message }（422 驗證、409 版本衝突…都有給使用者看的中文說明）。
// 連不上、逾時或回應裡沒有說明時，用呼叫端給的那句話。
export function apiErrorMessage(error, fallback = '') {
  return error?.response?.data?.message || fallback;
}
