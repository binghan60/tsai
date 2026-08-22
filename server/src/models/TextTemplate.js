import mongoose from 'mongoose';

const textTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    content: { type: String, required: true, trim: true, maxlength: 2000 },
    category: {
      type: String,
      enum: ['conclusion', 'care', 'history', 'exam', 'other'],
      default: 'other',
    },
    availableForAllFields: { type: Boolean, default: false },
    applicableItemKeys: [{ type: String, trim: true }],
    enabled: { type: Boolean, default: true },
    usageCount: { type: Number, default: 0, min: 0 },
    // 舊常用語轉換時用來保證重跑不會產生重複資料。
    legacyQuickPhraseId: { type: mongoose.Schema.Types.ObjectId, default: null, select: false },
  },
  { timestamps: true, optimisticConcurrency: true }
);

textTemplateSchema.index({ enabled: 1, category: 1, updatedAt: -1 });
textTemplateSchema.index({ applicableItemKeys: 1, enabled: 1 });
textTemplateSchema.index({ legacyQuickPhraseId: 1 }, { unique: true, sparse: true });

export default mongoose.model('TextTemplate', textTemplateSchema);
