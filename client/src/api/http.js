import axios from 'axios';

// 產 PDF 的端點（結案、下載、寄送 Email）要開 Chromium 把報告頁截下來，
// 順利時也要好幾秒，所以那幾支呼叫時要另外放寬到這個秒數。
export const PDF_TIMEOUT_MS = 120000;

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  withCredentials: true,
  // 沒有 timeout 的話 axios 會無限等待：後端卡住時畫面只會一直轉，
  // 使用者除了重整沒有別的線索。一般 CRUD 撐到十五秒還沒回，多半已經出事了。
  timeout: 15000,
});

// 401 代表登入 cookie 已經失效（過期、登出、或帳號在別處被撤銷 session）。
// 這裡不直接 import router／auth store 導轉，避免跟它們形成循環依賴
// （store 會 import http），改發一個全域事件，交給 App.vue 統一處理。
// /auth/ 開頭的呼叫本身就是在查詢或嘗試登入狀態，401 是預期結果，不算「被踢出」。
http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !error.config?.url?.startsWith('/auth/') && !error.config?.url?.startsWith('/public/')) {
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    }
    return Promise.reject(error);
  },
);
