import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { connectDB } from './config/db.js';
import { assertAppOriginConfigured } from './config/publicUrl.js';
import { assertJwtConfigured, authEnabled, ensureBootstrapUser } from './config/auth.js';
import authRouter, { requireAuthentication } from './routes/auth.js';
import ownersRouter from './routes/owners.js';
import { ownerPetsRouter, petsRouter } from './routes/pets.js';
import { petRecordsRouter, recordsRouter, publicReportsRouter } from './routes/records.js';
import appointmentsRouter from './routes/appointments.js';
import deliveryLogsRouter from './routes/deliveryLogs.js';
import dashboardRouter from './routes/dashboard.js';
import searchRouter from './routes/search.js';
import settingsRouter from './routes/settings.js';
import textTemplatesRouter from './routes/textTemplates.js';
import quickMenusRouter from './routes/quickMenus.js';
import { closeBrowser } from './lib/pdf.js';
import { resumePdfJobs } from './lib/reportPdfJobs.js';

const app = express();
const clientDistPath = fileURLToPath(new URL('../../client/dist/', import.meta.url));
let httpServer = null;
let shuttingDown = false;

app.set('trust proxy', 1);
// cors 套件在 origin 為 falsy 時會回 `Access-Control-Allow-Origin: *`，
// 所以未設定 CLIENT_ORIGIN 時直接不掛載，只接受同源請求。
if (process.env.CLIENT_ORIGIN) {
  app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }));
} else {
  console.warn('[cors] 未設定 CLIENT_ORIGIN，僅允許同源請求');
}
app.use(express.json());

app.get('/api/health/live', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/health', async (req, res) => {
  if (shuttingDown || mongoose.connection.readyState !== 1) {
    return res.status(503).json({ status: 'unavailable', database: 'disconnected' });
  }
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 }, { maxTimeMS: 1000 });
    if (!hello.setName && hello.msg !== 'isdbgrid') {
      return res.status(503).json({
        status: 'unavailable',
        database: 'connected',
        transactions: 'unsupported',
      });
    }
    return res.json({ status: 'ok', database: 'connected', transactions: 'supported' });
  } catch {
    return res.status(503).json({ status: 'unavailable', database: 'unreachable' });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/public/reports', publicReportsRouter);
app.use('/api', requireAuthentication);
app.use('/api/owners/:ownerId/pets', ownerPetsRouter);
app.use('/api/owners', ownersRouter);
app.use('/api/pets/:petId/records', petRecordsRouter);
app.use('/api/pets', petsRouter);
app.use('/api/records', recordsRouter);
app.use('/api/appointments', appointmentsRouter);
app.use('/api/delivery-logs', deliveryLogsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/search', searchRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/text-templates', textTemplatesRouter);
app.use('/api/quick-menus', quickMenusRouter);

app.use('/api', (req, res) => {
  res.status(404).json({ message: '找不到 API 路由' });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error(err);
  // 設定問題不是使用者做錯什麼，訊息要講得出「該去改哪個環境變數」。
  if (err.code === 'PUBLIC_URL_NOT_CONFIGURED') {
    return res.status(503).json({ message: err.message });
  }
  if (Number.isInteger(err.status) && err.status >= 400 && err.status < 600) {
    return res.status(err.status).json({ message: err.message, ...(err.details ?? {}) });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ message: '參數格式不正確' });
  }
  if (err.name === 'ValidationError') {
    return res.status(422).json({ message: err.message });
  }
  if (err.name === 'VersionError') {
    return res.status(409).json({ message: '資料已被其他分頁或使用者更新，請重新整理後再試' });
  }
  if (err.code === 11000) {
    return res.status(409).json({ message: '資料已存在或正在被另一個操作更新，請重新整理後再試' });
  }
  res.status(500).json({ message: '伺服器發生錯誤' });
});

export async function startServer() {
  if (httpServer) return httpServer;
  shuttingDown = false;
  const port = process.env.PORT || 3000;

  // 對外連結的網域要在啟動時就確定。漏設 PUBLIC_APP_URL 在正式環境是致命的。
  assertAppOriginConfigured();
  assertJwtConfigured();
  if (!authEnabled()) {
    console.warn('[auth] 目前未啟用登入驗證，/api/* 對外完全公開（設定 AUTH_ENABLED=true 啟用）');
  }
  await connectDB();
  await ensureBootstrapUser();
  await resumePdfJobs();
  httpServer = app.listen(port, () => console.log(`[server] listening on http://localhost:${port}`));
  return httpServer;
}

export async function stopServer({ forceExit = false } = {}) {
  if (shuttingDown) return;
  shuttingDown = true;
  const server = httpServer;
  httpServer = null;

  if (server) {
    await new Promise((resolve) => server.close(() => resolve()));
  }
  await closeBrowser();
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (forceExit) process.exit(0);
}

function installShutdownHandlers() {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      // 平台最終仍可能強制終止；先停止接新請求，讓已進行的寄信與 transaction 有機會完成。
      const hardStop = setTimeout(() => process.exit(1), 30_000);
      hardStop.unref?.();
      stopServer({ forceExit: true }).catch((err) => {
        console.error('[shutdown] 關機失敗', err);
        process.exit(1);
      });
    });
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  startServer()
    .then(installShutdownHandlers)
    .catch((err) => {
      console.error(err.code === 'PUBLIC_URL_NOT_CONFIGURED' ? '[config]' : '[startup]', err.message);
      process.exit(1);
    });
}

export { app };
