import mongoose from 'mongoose';
import { DRUG_NAME_MAX_LENGTH } from '../lib/drugs.js';

// 藥櫃分類。藥品只屬於一個分類（Drug.groupId，null＝未分類，未分類不是一筆資料）。
// sortOrder 是手動順序：刻意不設 default，沒排過的退回建立時間（shared/drugOrder.js），新增的在最後。
const drugGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: DRUG_NAME_MAX_LENGTH },
    nameKey: { type: String, required: true },
    sortOrder: { type: Number },
  },
  { timestamps: true, optimisticConcurrency: true }
);

drugGroupSchema.index({ nameKey: 1 }, { unique: true });

export default mongoose.model('DrugGroup', drugGroupSchema);
