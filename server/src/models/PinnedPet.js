import mongoose from 'mongoose';

// 全站共用的寵物暫存區：櫃台接電話時把某隻動物丟給醫生看病歷用。
// 一隻寵物最多一筆，重複放入只把它推回最前面；只能手動移除，不隨日期清空。
const pinnedPetSchema = new mongoose.Schema(
  {
    petId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pet', required: true },
    pinnedBy: { type: String, enum: ['vet', 'front_desk'], required: true },
    source: { type: String, enum: ['mention', 'manual'], required: true },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage', default: null },
    pinnedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);
pinnedPetSchema.index({ petId: 1 }, { unique: true });
pinnedPetSchema.index({ pinnedAt: -1 });

export default mongoose.model('PinnedPet', pinnedPetSchema);
