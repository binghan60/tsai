import mongoose from 'mongoose';
import Appointment from '../models/Appointment.js';
import Pet from '../models/Pet.js';
import MedicationOrder from '../models/MedicationOrder.js';

async function dropRetiredCheckinNumberIndexes() {
  const retiredIndexes = ['date_1_checkinNumber_1', 'date_1_checkinNumberHistory_1'];
  await Promise.all(retiredIndexes.map(async (name) => {
    try {
      await Appointment.collection.dropIndex(name);
    } catch (err) {
      if (![26, 27].includes(err?.code) && !['IndexNotFound', 'NamespaceNotFound'].includes(err?.codeName)) throw err;
    }
  }));
}

export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('缺少 MONGODB_URI 環境變數');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  // 舊版曾把「開始包藥」獨立成 packing；新版合併回待包藥，啟動時安全升級既有資料。
  await MedicationOrder.updateMany({ status: 'packing' }, { $set: { status: 'approved' } });
  await dropRetiredCheckinNumberIndexes();
  await Pet.syncIndexes();
  console.log('[db] MongoDB 已連線');
}
