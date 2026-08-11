import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { connectDB } from './config/db.js';
import ownersRouter from './routes/owners.js';
import { ownerPetsRouter, petsRouter } from './routes/pets.js';

const app = express();

app.use(cors({ origin: process.env.CLIENT_ORIGIN }));
app.use(express.json());

app.use('/api/owners/:ownerId/pets', ownerPetsRouter);
app.use('/api/owners', ownersRouter);
app.use('/api/pets', petsRouter);

app.use((err, req, res, next) => {
  console.error(err);
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
