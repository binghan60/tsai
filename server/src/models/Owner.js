import mongoose from 'mongoose';
import { liveInvalidation } from '../lib/liveInvalidation.js';
import { emitPatientsUpdate } from '../lib/realtime.js';

const ownerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    landline: { type: String, default: '', trim: true },
    email: { type: String, trim: true },
    address: { type: String, trim: true },
    notes: { type: String, trim: true },
    // 子資料建立時會遞增，讓「新增貓咪」與「刪除飼主」在 transaction 中產生寫入衝突。
    relationVersion: { type: Number, default: 0, select: false },
  },
  { timestamps: true, optimisticConcurrency: true }
);

ownerSchema.index({ name: 1 });
ownerSchema.index({ phone: 1 });
ownerSchema.index({ createdAt: -1, _id: -1 });

// 任何路徑寫入（含背景工作）都通知前端重讀，見 lib/liveInvalidation.js。
liveInvalidation(ownerSchema, emitPatientsUpdate);

export default mongoose.model('Owner', ownerSchema);
