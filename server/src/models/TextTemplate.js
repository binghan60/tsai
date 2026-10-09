import mongoose from 'mongoose';
import { richTextMaxLength } from '../lib/richTextSchema.js';

const textTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    // 帶格式標記（shared/richText.js）：粗體與四色。字數上限算純文字。
    content: { type: String, required: true, trim: true, validate: richTextMaxLength(2000) },
    availableForAllFields: { type: Boolean, default: false },
    applicableItemKeys: [{ type: String, trim: true }],
    enabled: { type: Boolean, default: true },
    usageCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, optimisticConcurrency: true }
);

textTemplateSchema.index({ enabled: 1, updatedAt: -1 });
textTemplateSchema.index({ applicableItemKeys: 1, enabled: 1 });

export default mongoose.model('TextTemplate', textTemplateSchema);
