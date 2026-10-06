import { reactive, readonly } from 'vue';
import { http } from '../api/http';

// 後台登入狀態。放在模組層級而不是元件裡：路由守衛與 axios 攔截器都在元件之外，
// 而且全站只該有一份。
//
// status：unknown＝還沒問到伺服器；authenticated／anonymous＝問過了。
// authRequired：伺服器沒設密碼（本機開發）時是 false，這時沒有登入頁也沒有登出鈕。
const state = reactive({
  status: 'unknown',
  authRequired: true,
  reloginOpen: false,
});

function applySession({ authRequired, authenticated }) {
  state.authRequired = authRequired !== false;
  state.status = authenticated ? 'authenticated' : 'anonymous';
}

let sessionRequest = null;

// 路由守衛每次換頁都會呼叫，但只有第一次（或上次沒問到）真的發請求。
export function ensureSession() {
  if (state.status !== 'unknown') return Promise.resolve(state.status);
  sessionRequest ??= http
    .get('/auth/session', { skipAuthRetry: true })
    .then(({ data }) => {
      applySession(data);
      return state.status;
    })
    // 問不到（斷線、伺服器重啟中）不等於沒登入。維持 unknown 讓頁面照常開，
    // 連不上這件事由各頁自己的錯誤狀態去說；下次換頁會再問一次。
    .catch(() => 'unknown')
    .finally(() => {
      sessionRequest = null;
    });
  return sessionRequest;
}

// 用到一半登入失效時（太久沒用、在別處登出、密碼被換掉），正在等的請求都停在這裡。
let reloginWaiters = [];

function waitForRelogin() {
  state.status = 'anonymous';
  state.reloginOpen = true;
  return new Promise((resolve) => {
    reloginWaiters.push(resolve);
  });
}

export async function login(password) {
  const { data } = await http.post('/auth/login', { password }, { skipAuthRetry: true });
  applySession(data);
  state.reloginOpen = false;
  const waiters = reloginWaiters;
  reloginWaiters = [];
  waiters.forEach((resolve) => resolve());
}

export async function logout() {
  await http.post('/auth/logout', null, { skipAuthRetry: true });
  // 整頁重新載入而不是 router.push：記憶體裡還留著剛才載入的飼主與報告資料
  //（元件狀態、各 composable 的快取），重新載入才清得乾淨。
  window.location.assign('/login');
}

// 後台 API 回 401 只有一種意思：登入失效了（登入與查詢狀態那幾支有標 skipAuthRetry，
// 不會走到這裡）。
//
// 這時不把人導去登入頁，而是原地跳出重新登入的對話框，登入後把剛才的請求重送一次。
// 換頁的話，填到一半的報告會被「離開前攔截未儲存變更」卡住，或者直接丟掉。
// 重送是安全的：401 是門禁在最前面擋下的，伺服器還沒對那個請求做任何事。
http.interceptors.response.use(undefined, async (error) => {
  const config = error.config;
  if (error.response?.status !== 401 || !config || config.skipAuthRetry || config.authRetried) throw error;
  await waitForRelogin();
  // authRetried：重送後還是 401 就照一般錯誤處理，不要無限循環。
  return http.request({ ...config, authRetried: true });
});

export function useAuth() {
  return { auth: readonly(state), login, logout };
}
