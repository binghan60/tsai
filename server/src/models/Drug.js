import mongoose from 'mongoose';
import { DRUG_NAME_MAX_LENGTH } from '../lib/drugs.js';
import { richTextMaxLength } from '../lib/richTextSchema.js';

// 藥櫃：醫師打藥單時邊打邊跳的建議清單，也是「藥櫃」視窗裡分類排好的藥品。
// 一筆就是一行要插進藥單的文字（可以連劑量一起寫）。
// nameKey 是不分大小寫的名稱（lib/drugs.js 的 drugNameKey），擋重複。
const drugSchema = new mongoose.Schema(
  {
    // 可格式化（粗體、六色標記），字數上限看純文字。
    name: { type: String, required: true, trim: true, validate: richTextMaxLength(DRUG_NAME_MAX_LENGTH) },
    nameKey: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    // 所屬分類；null＝未分類。
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'DrugGroup', default: null },
    // 同一分類內的手動順序。刻意不設 default（理由同 Todo.sortOrder）。
    sortOrder: { type: Number },
  },
  { timestamps: true, optimisticConcurrency: true }
);

drugSchema.index({ nameKey: 1 }, { unique: true });
drugSchema.index({ groupId: 1, sortOrder: 1 });

export default mongoose.model('Drug', drugSchema);
