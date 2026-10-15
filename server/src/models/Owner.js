import mongoose from 'mongoose';
import { liveInvalidation } from '../lib/liveInvalidation.js';
import { emitPatientsUpdate } from '../lib/realtime.js';

const ownerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // ''＝一般飼主；clinic＝系統內建的「院內」飼主，沒人負責的流浪貓掛在它名下（lib/clinicOwner.js）。
    // 院內只有一筆、沒有手機，不能編輯或刪除，飼主搜尋不列它。
    kind: { type: String, enum: ['', 'clinic'], default: '' },
    phone: { type: String, required() { return this.kind !== 'clinic'; }, default: '', trim: true },
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
ownerSchema.index({ kind: 1 }, { unique: true, partialFilterExpression: { kind: 'clinic' } });

// 任何路徑寫入（含背景工作）都通知前端重讀，見 lib/liveInvalidation.js。
liveInvalidation(ownerSchema, emitPatientsUpdate);

export default mongoose.model('Owner', ownerSchema);
