import mongoose from 'mongoose';
import Appointment from '../models/Appointment.js';
import Pet from '../models/Pet.js';

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
  await dropRetiredCheckinNumberIndexes();
  await Pet.syncIndexes();
  console.log('[db] MongoDB 已連線');
}
