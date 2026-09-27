// 報到建立的健檢報告草稿，體重、體溫、回診日期與檢驗數值預設跟著這次看診走（後端 lib/recordVisitSync.js）。
// 填寫頁要做兩件事：
//   1. 醫師親手改了某個跟隨欄位 → 存檔時把它放進 overriddenKeys，之後看診再改也不覆蓋它；
//   2. 存檔回來的草稿帶著看診的最新值 → 沒被覆寫的欄位直接換成新值。
// 判斷「親手改了」的方法是跟上一次從伺服器拿到的值比，不必在每個欄位元件裡各自掛事件。

export const FOLLOWED_FIELD_LABELS = { weightKg: '體重', temperatureC: '體溫', followUpDate: '回診日期' };
export const labKey = (key) => `lab:${key}`;

export function followableKeys(labItems = []) {
  return ['weightKg', 'temperatureC', 'followUpDate', ...labItems.map((item) => labKey(item.key))];
}

function numberText(value) {
  if (value === null || value === undefined || String(value).trim() === '') return '';
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : String(value).trim();
}

// 把一個欄位的值轉成可以比較的字串。source 是 { weightKg, temperatureC, followUp, labFindings }，
// followUp 是「日期 時間」組好的字串（畫面上日期與時間是兩個欄位）。
export function followedValue(source, key) {
  if (key === 'weightKg' || key === 'temperatureC') return numberText(source?.[key]);
  if (key === 'followUpDate') return String(source?.followUp ?? '').trim();
  if (key.startsWith('lab:')) {
    const itemKey = key.slice(4);
    return String((source?.labFindings ?? []).find((finding) => finding.key === itemKey)?.value ?? '').trim();
  }
  return '';
}

// 存檔要送的 overriddenKeys：原本就覆寫的，加上這次跟伺服器值不一樣的跟隨欄位。
export function nextOverriddenKeys({ keys, overridden = [], current, server }) {
  const next = new Set(overridden);
  for (const key of keys) {
    if (!next.has(key) && followedValue(current, key) !== followedValue(server, key)) next.add(key);
  }
  return keys.filter((key) => next.has(key));
}

// 存檔回來後，哪些欄位要把畫面換成伺服器（看診）的值：沒被覆寫、而且值不一樣的。
export function staleFollowedKeys({ keys, overridden = [], current, server }) {
  const skip = new Set(overridden);
  return keys.filter((key) => !skip.has(key) && followedValue(current, key) !== followedValue(server, key));
}
