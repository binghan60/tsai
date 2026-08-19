import axios from 'axios';

// 產 PDF 的端點（結案、下載、寄送 Email）要開 Chromium 把報告頁截下來，
// 順利時也要好幾秒，所以那幾支呼叫時要另外放寬到這個秒數。
export const PDF_TIMEOUT_MS = 120000;

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  // 沒有 timeout 的話 axios 會無限等待：後端卡住時畫面只會一直轉，
  // 使用者除了重整沒有別的線索。一般 CRUD 撐到十五秒還沒回，多半已經出事了。
  timeout: 15000,
});
