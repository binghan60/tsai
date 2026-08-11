import mongoose from 'mongoose';

export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('缺少 MONGODB_URI 環境變數');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  console.log('[db] MongoDB 已連線');
}
