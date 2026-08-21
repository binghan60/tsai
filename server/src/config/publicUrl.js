// 對外連結（分享網址、寄給飼主的 Email 內文）用的網域。
//
// 為什麼不從請求推斷：Host 與 X-Forwarded-Host 是呼叫端寫進來的字串，不是伺服器
// 知道的事實。這個值會被組成連結放進真的寄出去的信裡，被指到別的網域時，飼主收到的
// 就是一封由診所 Gmail 寄出、卻連往他人網站的「健檢報告」。在還沒有認證機制之前
// 尤其危險：任何人都能觸發 POST /api/records/:id/send-email。
//
// 所以正式環境一律要求明確設定，而且在啟動時就檢查 —— 設定漏了要在部署當下爆，
// 不是在第一封信寄出去之後才發現。開發環境保留 Host 推斷，本機沒有這個威脅。

// 依序取用，前面的有值就不看後面的。
const ORIGIN_KEYS = ['PUBLIC_APP_URL', 'CLIENT_ORIGIN', 'ZEABUR_WEB_URL'];

// 同一件事只提醒一次。這些檢查每次產生連結都會跑，不去重的話每寄一封信、
// 每建一個分享連結都會再印一遍，真正該注意的訊息反而被洗掉。
const warned = new Set();
function warnOnce(token, message) {
  if (warned.has(token)) return;
  warned.add(token);
  console.warn(message);
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

// 讀出設定好的對外網域，沒有任何一個有值就回空字串。
// 設定值本身有問題（打錯字）不能當成「沒設定」處理 —— 那會讓錯的連結安靜地寄出去，
// 所以直接丟例外，由啟動檢查接住。
export function configuredAppOrigin() {
  for (const key of ORIGIN_KEYS) {
    const raw = process.env[key]?.trim();
    if (!raw) continue;

    // 平台注入的變數有時只有網域沒有協定。補上 https 而不是拒絕，
    // 但要把補了什麼講出來，否則使用者會以為自己填的字串就是最後生效的值。
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    if (candidate !== raw) warnOnce(`scheme:${key}`, `[url] ${key} 沒有帶協定，視為 ${candidate}`);

    let parsed;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new Error(`${key} 不是合法的網址：${raw}`);
    }
    // 前端掛在網域根目錄，帶路徑的設定值組不出正確的 /report/:token。
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
      warnOnce(`path:${key}`, `[url] ${key} 帶了路徑或查詢字串，實際只會採用 ${parsed.origin}`);
    }
    return parsed.origin;
  }
  return '';
}

// 啟動時呼叫：正式環境沒設定就讓服務起不來。
export function assertAppOriginConfigured() {
  const origin = configuredAppOrigin();
  if (origin) return origin;
  if (isProduction()) {
    throw new Error(
      '正式環境必須設定 PUBLIC_APP_URL：分享連結與寄給飼主的 Email 都會用到它，'
      + '從請求的 Host 推斷等於讓呼叫端決定信裡的網址。'
    );
  }
  warnOnce('fallback', '[url] 未設定 PUBLIC_APP_URL，對外連結改用請求的 Host 推斷（僅限開發）');
  return '';
}

export function publicAppOrigin(req) {
  const origin = configuredAppOrigin();
  if (origin) return origin;
  if (isProduction()) {
    // 啟動檢查應該已經擋掉了；真的走到這裡代表環境變數在執行期被清掉。
    // 寧可讓這次操作失敗，也不要寄出一個網域錯誤的連結。
    const error = new Error('尚未設定 PUBLIC_APP_URL，無法產生對外連結');
    error.code = 'PUBLIC_URL_NOT_CONFIGURED';
    throw error;
  }

  const forwardedProtocol = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim();
  const protocol = forwardedProtocol || req.protocol;
  const host = forwardedHost || req.get('host');
  return `${protocol}://${host}`;
}
