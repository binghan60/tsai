import mongoose from 'mongoose';
import { DRUG_NAME_MAX_LENGTH } from '../lib/drugs.js';

// 藥櫃：醫師打藥單時邊打邊跳的建議清單。一筆就是一行要插進藥單的文字（可以連劑量一起寫）。
// nameKey 是不分大小寫的名稱（lib/drugs.js 的 drugNameKey），擋重複。
const drugSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: DRUG_NAME_MAX_LENGTH },
    nameKey: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    usageCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, optimisticConcurrency: true }
);

drugSchema.index({ nameKey: 1 }, { unique: true });

export default mongoose.model('Drug', drugSchema);
