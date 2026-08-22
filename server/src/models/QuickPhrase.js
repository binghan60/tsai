import mongoose from 'mongoose';

// 醫師自己累積的常用評語。itemKey 記住這句話屬於哪個欄位 ——
// 常用語一律綁欄位，沒有跨欄位共用的通用語。
const quickPhraseSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 500 },
    itemKey: { type: String, required: true, trim: true },
    // 用過幾次，決定清單順序。最常用的要在最前面，否則累積久了還是得找。
    usageCount: { type: Number, default: 0, min: 0 },
    // 文字模板功能上線後保留舊資料，但只轉換一次；模板日後被刪除時不應又自動復活。
    migratedAt: { type: Date, default: null, select: false },
  },
  { timestamps: true }
);

// 同一個欄位底下同一句話只留一筆。
quickPhraseSchema.index({ itemKey: 1, text: 1 }, { unique: true });

export default mongoose.model('QuickPhrase', quickPhraseSchema);
