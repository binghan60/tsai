import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDB } from './config/db.js';
import ownersRouter from './routes/owners.js';
import { ownerPetsRouter, petsRouter } from './routes/pets.js';
import { petRecordsRouter, recordsRouter, publicReportsRouter } from './routes/records.js';
import dashboardRouter from './routes/dashboard.js';
import searchRouter from './routes/search.js';
import settingsRouter from './routes/settings.js';
import quickPhrasesRouter from './routes/quickPhrases.js';

const app = express();
const clientDistPath = fileURLToPath(new URL('../../client/dist/', import.meta.url));

app.set('trust proxy', 1);
// cors 套件在 origin 為 falsy 時會回 `Access-Control-Allow-Origin: *`，
// 所以未設定 CLIENT_ORIGIN 時直接不掛載，只接受同源請求。
if (process.env.CLIENT_ORIGIN) {
  app.use(cors({ origin: process.env.CLIENT_ORIGIN }));
} else {
  console.warn('[cors] 未設定 CLIENT_ORIGIN，僅允許同源請求');
}
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/owners/:ownerId/pets', ownerPetsRouter);
app.use('/api/owners', ownersRouter);
app.use('/api/pets/:petId/records', petRecordsRouter);
app.use('/api/pets', petsRouter);
app.use('/api/records', recordsRouter);
app.use('/api/public/reports', publicReportsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/search', searchRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/quick-phrases', quickPhrasesRouter);

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
  if (err.name === 'CastError') {
    return res.status(400).json({ message: '參數格式不正確' });
  }
  if (err.name === 'ValidationError') {
    return res.status(422).json({ message: err.message });
  }
  res.status(500).json({ message: '伺服器發生錯誤' });
});

const PORT = process.env.PORT || 3000;

connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`[server] listening on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('[db] 連線失敗', err);
    process.exit(1);
  });
