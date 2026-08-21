import { ref } from 'vue';

// 主題有三種狀態，但只有兩個按鈕位置：
//   localStorage 沒有值 = 還沒表態 → 跟著系統走，系統換了畫面也跟著換
//   localStorage 有值   = 使用者表態過 → 以他的選擇為準，系統怎麼變都不管
//
// 開機時的初值由 index.html 的內嵌腳本決定（要在 body 之前就設好，不然會閃一下淺色），
// 這裡只接手後續的切換與系統變化，兩邊的判斷必須一致。

const STORAGE_KEY = 'theme';
const hasDocument = typeof document !== 'undefined';

// 無痕模式、或瀏覽器設定封鎖網站資料時，光是讀寫 localStorage 就會丟例外。
// 主題只是外觀偏好，存不進去不該讓畫面壞掉——當作「沒表態」處理即可。
function readStoredTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredTheme(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // 這次切換仍然生效，只是重新整理後回到跟隨系統。
  }
}

const isDark = ref(hasDocument && document.documentElement.classList.contains('dark'));

function paint(dark) {
  isDark.value = dark;
  if (hasDocument) document.documentElement.classList.toggle('dark', dark);
}

function toggleTheme() {
  const next = !isDark.value;
  // 按下切換就是表態，從這一刻起不再跟著系統跑。
  writeStoredTheme(next ? 'dark' : 'light');
  paint(next);
}

// 還沒表態的人，系統換了主題畫面要跟著換。表態過的就不要動他的選擇。
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
    if (readStoredTheme()) return;
    paint(event.matches);
  });
}

export function useTheme() {
  return { isDark, toggleTheme };
}
