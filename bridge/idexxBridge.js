// IDEXX 抓檔程式：跑在診所那台裝了 IDEXX InterLink 的 Windows 電腦上，
// 盯著 InterLink 存結果 XML 的資料夾，有新檔就上傳到系統（POST /api/lab-results/import），成功後移到「已上傳」。
//
// 刻意只用 Node 內建功能、不裝任何套件：整個 bridge 資料夾複製到診所電腦、裝好 Node.js 就能跑。
// 它也不解析 XML——檔案原封不動送上去，解析規則要改只改伺服器，不必再動診所那台電腦。
//
// 檔案絕不刪除：上傳成功移到「已上傳\年-月\」，伺服器一直讀不了的移到「無法讀取\」，連不上伺服器就留在原地重試。
//
// 反方向（報到通知）：設定了 requestsDir 時，每一輪也去伺服器拿待送的報到／離院通知（GET /api/lab-results/requests），
// 原封寫進 InterLink 的 Requests 資料夾、再回報寫好了。XML 由伺服器組好、編碼也編好，這裡一樣不碰內容。
// Requests 資料夾裡的檔案由 InterLink 自己收掉，這裡只放不刪。
import { mkdir, readFile, readdir, rename, stat, appendFile, writeFile } from 'node:fs/promises';
import { existsSync, statSync, renameSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ARCHIVE_DIR = '已上傳';
export const FAILED_DIR = '無法讀取';

const DEFAULTS = {
  pollSeconds: 10,
  // 檔案最後一次變動後至少要靜止這麼久才上傳，避免抓到 InterLink 寫到一半的檔案。
  settleSeconds: 3,
  // 伺服器一直說「檔案不完整／看不懂」超過這麼久，就不再重試、移到「無法讀取」等人處理。
  failAfterMinutes: 30,
  // 多久回報一次心跳。伺服器超過三分鐘沒收到就當作停了，所以不要設超過一分鐘。
  heartbeatSeconds: 60,
  // 一輪最多上傳幾份、兩份之間隔多久。IDEXX 主機補傳歷史紀錄時資料夾裡會一次出現幾百份，
  // 分批慢慢送（預設每 10 秒 20 份，300 份約兩分半），不要一口氣全部壓到伺服器上。
  maxFilesPerRound: 20,
  uploadGapMs: 200,
  // 系統上顯示的名稱；沒填就用電腦名稱。
  name: '',
  // InterLink 收報到通知的資料夾（預設 C:\IDEXX Interlink\Requests）；空的就不送報到通知。
  requestsDir: '',
};

// 寫報到通知時先寫在這個資料夾、寫完才搬進 Requests，InterLink 才不會讀到寫一半的檔案。
// 放在 Requests 旁邊（同一顆硬碟，搬移是一瞬間的事），不放在 Requests 裡面——InterLink 會不會去讀子資料夾不確定。
export const REQUESTS_TEMP_DIR = '.idexx-bridge-tmp';

export function normalizeConfig(raw) {
  const config = { ...DEFAULTS, ...raw };
  const problems = [];
  if (!/^https?:\/\//.test(config.serverUrl ?? '')) problems.push('serverUrl 要是 http:// 或 https:// 開頭的網址');
  if ((config.token ?? '').length < 32) problems.push('token 要跟伺服器的 IDEXX_BRIDGE_TOKEN 相同（至少 32 字元）');
  if (!config.resultsDir) problems.push('resultsDir 要填 InterLink 存結果 XML 的資料夾');
  if (problems.length) throw new Error(`設定檔有問題：\n- ${problems.join('\n- ')}`);
  return { ...config, serverUrl: config.serverUrl.replace(/\/+$/, '') };
}

// 同一個檔案要連續兩輪大小與修改時間都沒變，而且最後修改已經過了 settleMs，才算 InterLink 寫完了。
export function isSettled(previous, current, now, settleMs) {
  if (!previous) return false;
  if (previous.size !== current.size || previous.mtimeMs !== current.mtimeMs) return false;
  return current.size > 0 && now - current.mtimeMs >= settleMs;
}

// 依伺服器的回應決定這個檔案接下來怎麼處理：
//   archive 已經收下（新增、重複、更正、過期、不是結果都算）→ 移到「已上傳」
//   retry   這次不算，留在原地下一輪再試
//   fail    伺服器一直讀不了 → 移到「無法讀取」
export function outcomeFor(response, fileAgeMs, failAfterMs) {
  if (!response) return 'retry';
  if (response.status === 200 || response.status === 201) return 'archive';
  // 400 空檔案、422 不完整或看不懂：多半是還在寫，給它時間；太久還是這樣就是真的壞了。
  if (response.status === 400 || response.status === 422) return fileAgeMs >= failAfterMs ? 'fail' : 'retry';
  // 401 密鑰錯、503 伺服器沒設定、5xx、網路斷線：都不是檔案的錯，一直重試。
  return 'retry';
}

// 已上傳的檔案依月份分資料夾，同名就在檔名後面加上時間，不覆蓋舊檔。
export function archivePath(resultsDir, subdir, fileName, now, exists = existsSync) {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const dir = subdir === ARCHIVE_DIR ? path.join(resultsDir, subdir, month) : path.join(resultsDir, subdir);
  let target = path.join(dir, fileName);
  if (exists(target)) {
    const { name, ext } = path.parse(fileName);
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
    target = path.join(dir, `${name}-${stamp}${ext}`);
  }
  return target;
}

export async function uploadFile(config, filePath) {
  try {
    const response = await fetch(`${config.serverUrl}/api/lab-results/import`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.token}`,
        'content-type': 'application/xml',
        // HTTP 標頭只能放 ASCII，中文檔名先做 URL 編碼。
        'x-file-name': encodeURIComponent(path.basename(filePath)),
      },
      body: await readFile(filePath),
      signal: AbortSignal.timeout(30_000),
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } catch (err) {
    return { status: 0, body: null, error: err.message };
  }
}

async function moveTo(config, filePath, subdir, now) {
  const target = archivePath(config.resultsDir, subdir, path.basename(filePath), now);
  await mkdir(path.dirname(target), { recursive: true });
  await rename(filePath, target);
  return target;
}

// 掃一輪資料夾。seen 記住上一輪每個檔案的大小與修改時間，用來判斷檔案寫完了沒。
export async function processFolder(config, { seen, upload = uploadFile, now = () => new Date(), log = () => {} }) {
  const entries = await readdir(config.resultsDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.xml$/i.test(entry.name)) continue;
    const filePath = path.join(config.resultsDir, entry.name);
    const info = await stat(filePath);
    files.push({ filePath, name: entry.name, size: info.size, mtimeMs: info.mtimeMs });
  }
  // 依修改時間舊到新上傳：IDEXX 的更正版比原始版晚寫出來，順序對了伺服器才不會把它當成過期。
  files.sort((a, b) => a.mtimeMs - b.mtimeMs);

  const summary = { archived: 0, failed: 0, waiting: 0, retry: 0 };
  const present = new Set(files.map((file) => file.name));
  for (const name of seen.keys()) if (!present.has(name)) seen.delete(name);

  const maxUploads = config.maxFilesPerRound > 0 ? config.maxFilesPerRound : Infinity;
  let uploads = 0;
  for (const file of files) {
    const previous = seen.get(file.name);
    const entry = { size: file.size, mtimeMs: file.mtimeMs, warned: previous?.warned ?? false };
    seen.set(file.name, entry);
    const current = now();
    if (!isSettled(previous, file, current.getTime(), config.settleSeconds * 1000)) {
      summary.waiting += 1;
      continue;
    }
    // 這一輪的額度用完了：剩下的留在資料夾，下一輪接著送（仍然記住它們寫完了，不必重新等）。
    if (uploads >= maxUploads) continue;
    if (uploads > 0 && config.uploadGapMs > 0) await new Promise((resolve) => setTimeout(resolve, config.uploadGapMs));
    uploads += 1;

    const response = await upload(config, file.filePath);
    const outcome = outcomeFor(response, current.getTime() - file.mtimeMs, config.failAfterMinutes * 60_000);
    if (outcome === 'archive') {
      await moveTo(config, file.filePath, ARCHIVE_DIR, current);
      seen.delete(file.name);
      summary.archived += 1;
      log(`已上傳 ${file.name}（${response.body?.status ?? response.status}）`);
    } else if (outcome === 'fail') {
      await moveTo(config, file.filePath, FAILED_DIR, current);
      seen.delete(file.name);
      summary.failed += 1;
      log(`無法讀取 ${file.name}，已移到「${FAILED_DIR}」：${response.body?.message ?? response.status}`);
    } else {
      summary.retry += 1;
      if (response.status === 422 || response.status === 400) {
        // 同一個檔案只提醒一次，之後每 10 秒的重試不再重複記。
        if (!entry.warned) log(`${file.name} 伺服器暫時讀不了，稍後再試：${response.body?.message ?? response.status}`);
        entry.warned = true;
        continue;
      }
      // 連不上伺服器或密鑰錯：其他檔案也一定失敗，這一輪先停，下一輪再試。
      summary.error = response.error ?? `HTTP ${response.status}：${response.body?.message ?? ''}`;
      break;
    }
  }
  // 還留在資料夾裡的 XML：心跳會回報，一直不歸零代表有檔案卡住。
  summary.pending = files.length - summary.archived - summary.failed;
  return summary;
}

async function bridgeRequest(config, pathname, { method = 'GET', body } = {}) {
  try {
    const response = await fetch(`${config.serverUrl}${pathname}`, {
      method,
      headers: { authorization: `Bearer ${config.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return { status: response.status, body: payload };
  } catch (err) {
    return { status: 0, body: null, error: err.message };
  }
}

export function fetchRequests(config) {
  return bridgeRequest(config, '/api/lab-results/requests');
}

export function confirmRequest(config, id, bridgeId) {
  return bridgeRequest(config, `/api/lab-results/requests/${encodeURIComponent(id)}/delivered`, { method: 'POST', body: { bridgeId } });
}

// 檔名由伺服器給（訊息編號.xml），還是只留安全的字元，不讓任何內容寫到 Requests 以外的地方。
export function requestFileName(name) {
  const base = path.basename(String(name ?? '')).replace(/[^\w.-]/g, '');
  return /\.xml$/i.test(base) && base.length > 4 ? base : null;
}

// 拿一輪報到通知寫進 Requests。回傳 { written, error }。
// 寫好才回報伺服器；回報失敗下一輪會再拿到同一份，寫成同一個檔名（覆蓋），不會多出第二份。
export async function deliverRequests(config, { list = fetchRequests, confirm = confirmRequest, bridgeId = config.name || os.hostname(), log = () => {} } = {}) {
  const summary = { written: 0 };
  if (!config.requestsDir) return summary;
  if (!existsSync(config.requestsDir)) return { ...summary, error: `找不到報到通知資料夾：${config.requestsDir}` };
  const response = await list(config);
  if (response.status !== 200) {
    return { ...summary, error: response.error ?? `拿報到通知失敗 HTTP ${response.status}：${response.body?.message ?? ''}` };
  }
  const tempDir = path.join(path.dirname(path.resolve(config.requestsDir)), REQUESTS_TEMP_DIR);
  for (const item of response.body?.items ?? []) {
    const fileName = requestFileName(item.fileName);
    if (!fileName || typeof item.body !== 'string') continue;
    await mkdir(tempDir, { recursive: true });
    const tempPath = path.join(tempDir, fileName);
    await writeFile(tempPath, Buffer.from(item.body, 'base64'));
    await rename(tempPath, path.join(config.requestsDir, fileName));
    summary.written += 1;
    log(`已寫入報到通知 ${fileName}`);
    const confirmed = await confirm(config, item.id, bridgeId);
    if (confirmed.status !== 200) return { ...summary, error: confirmed.error ?? `回報報到通知失敗 HTTP ${confirmed.status}` };
  }
  return summary;
}

export function heartbeatPayload(config, state, { hostname = os.hostname(), version = '' } = {}) {
  return {
    bridgeId: config.name || hostname,
    hostname,
    version,
    resultsDir: config.resultsDir,
    requestsDir: config.requestsDir ?? '',
    startedAt: state.startedAt?.toISOString() ?? null,
    lastUploadAt: state.lastUploadAt?.toISOString() ?? null,
    pendingFiles: state.pendingFiles ?? 0,
    lastError: state.lastError ?? '',
  };
}

export function sendHeartbeat(config, payload) {
  return bridgeRequest(config, '/api/lab-results/heartbeat', { method: 'POST', body: payload });
}

// log 同時印在視窗上與寫進 bridge 資料夾的 idexx-bridge.log；超過 5MB 就換成 .old 重新開始。
function createLogger(logFile) {
  return async (message) => {
    const line = `${new Date().toLocaleString('zh-TW', { hour12: false })}  ${message}`;
    console.log(line);
    try {
      if (existsSync(logFile) && statSync(logFile).size > 5 * 1024 * 1024) renameSync(logFile, `${logFile}.old`);
      await appendFile(logFile, `${line}\n`, 'utf8');
    } catch {
      // 寫不了 log 不影響上傳。
    }
  };
}

// 安裝前（install.ps1）與遠端排查時用：確認設定檔、資料夾與伺服器都沒問題，送一次心跳就結束。
async function check(config, version) {
  const problems = [];
  if (!existsSync(config.resultsDir)) problems.push(`找不到要盯的資料夾：${config.resultsDir}`);
  const response = await sendHeartbeat(config, heartbeatPayload(config, { startedAt: new Date() }, { version }));
  if (response.status === 200) {
    console.log(`✔ 伺服器連線與密鑰正確（${config.serverUrl}）`);
  } else if (response.status === 0) {
    problems.push(`連不上伺服器 ${config.serverUrl}：${response.error}`);
  } else {
    problems.push(`伺服器回應 HTTP ${response.status}：${response.body?.message ?? ''}`);
  }
  if (config.requestsDir && !existsSync(config.requestsDir)) problems.push(`找不到報到通知資料夾：${config.requestsDir}`);
  if (!problems.length) {
    console.log(`✔ 資料夾存在（${config.resultsDir}）`);
    if (config.requestsDir) console.log(`✔ 報到通知資料夾存在（${config.requestsDir}）`);
  }
  for (const problem of problems) console.error(`✘ ${problem}`);
  return problems.length === 0;
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const args = process.argv.slice(2);
  const configArg = args.find((arg) => !arg.startsWith('--'));
  const configPath = configArg ? path.resolve(configArg) : path.join(here, 'idexx-bridge.config.json');
  const log = createLogger(path.join(here, 'idexx-bridge.log'));
  let version = '';
  try {
    version = JSON.parse(await readFile(path.join(here, 'package.json'), 'utf8')).version ?? '';
  } catch {
    version = '';
  }

  let config;
  try {
    config = normalizeConfig(JSON.parse(await readFile(configPath, 'utf8')));
  } catch (err) {
    console.error(`讀不到設定檔 ${configPath}\n${err.message}`);
    process.exit(1);
  }
  if (args.includes('--check')) process.exit((await check(config, version)) ? 0 : 1);
  if (!existsSync(config.resultsDir)) {
    console.error(`找不到要盯的資料夾：${config.resultsDir}`);
    process.exit(1);
  }

  await log(`開始監看 ${config.resultsDir}，上傳到 ${config.serverUrl}（每 ${config.pollSeconds} 秒一輪，版本 ${version}）`);
  if (config.requestsDir) await log(`報到通知寫進 ${config.requestsDir}`);
  const seen = new Map();
  const state = { startedAt: new Date(), lastUploadAt: null, pendingFiles: 0, lastError: '' };
  let lastError = null;
  let lastRequestError = null;
  let lastHeartbeatAt = 0;
  for (;;) {
    try {
      const summary = await processFolder(config, { seen, log });
      // 同一個錯誤只在第一次出現與恢復時各記一次，不要每 10 秒洗一行。
      if (summary.error && summary.error !== lastError) await log(`暫時無法上傳，會自動重試：${summary.error}`);
      if (!summary.error && lastError) await log('已恢復連線');
      lastError = summary.error ?? null;
      if (summary.archived) state.lastUploadAt = new Date();
      state.pendingFiles = summary.pending;
    } catch (err) {
      if (err.message !== lastError) await log(`掃描資料夾失敗：${err.message}`);
      lastError = err.message;
    }
    // 報到通知跟上傳結果互不影響：一邊壞了另一邊照樣做。
    let requestError = null;
    try {
      requestError = (await deliverRequests(config, { log })).error ?? null;
    } catch (err) {
      requestError = `寫入報到通知失敗：${err.message}`;
    }
    if (requestError && requestError !== lastRequestError) await log(requestError);
    if (!requestError && lastRequestError) await log('報到通知已恢復');
    lastRequestError = requestError;
    state.lastError = [lastError, requestError].filter(Boolean).join('；');
    // 心跳失敗不另外記 log：連不上伺服器時上面的上傳錯誤已經記過了。
    if (Date.now() - lastHeartbeatAt >= config.heartbeatSeconds * 1000) {
      lastHeartbeatAt = Date.now();
      await sendHeartbeat(config, heartbeatPayload(config, state, { version }));
    }
    await new Promise((resolve) => setTimeout(resolve, config.pollSeconds * 1000));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
