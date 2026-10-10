import mongoose from 'mongoose';

// 跨文件的寫入都走 transaction（lib/transaction.js），所以連的 MongoDB 必須是 replica set（Atlas 預設就是）。
// 索引由各 model 的 schema 宣告、連線後由 mongoose 自動建立。
export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('缺少 MONGODB_URI 環境變數');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  console.log('[db] MongoDB 已連線');
}
