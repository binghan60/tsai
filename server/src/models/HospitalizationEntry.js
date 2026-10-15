import mongoose from 'mongoose';
import { richTextMaxLength } from '../lib/richTextSchema.js';

// 住院照護紀錄：紙本那張表的一格——時間、食物放置、灌食、用藥、其他，另加選填的體溫。
// 一天幾格不設上限。住院中與出院後都能改（事後更正），多台裝置同時改靠版本號擋。
const hospitalizationEntrySchema = new mongoose.Schema(
  {
    hospitalizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospitalization', required: true },
    petId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pet', required: true },
    recordedAt: { type: Date, required: true },
    food: { type: String, default: '', trim: true, maxlength: 200 },
    forceFeeding: { type: String, default: '', trim: true, maxlength: 200 },
    // 用藥：跟藥單同一種格式標記（shared/richText.js），打字時跳藥櫃建議。
    medication: { type: String, default: '', trim: true, validate: richTextMaxLength(2000) },
    other: { type: String, default: '', trim: true, maxlength: 2000 },
    temperatureC: { type: Number, min: 0, default: null },
    // 寫這一格的裝置身分（醫師／櫃台）。
    staff: { type: String, enum: ['vet', 'front_desk', ''], default: '' },
    // 收住院時從那次看診的藥單搬過來的那一格：取消住院時搬回看診上。
    fromVisit: { type: Boolean, default: false },
  },
  { timestamps: true, optimisticConcurrency: true }
);

hospitalizationEntrySchema.index({ hospitalizationId: 1, recordedAt: 1, _id: 1 });

export default mongoose.model('HospitalizationEntry', hospitalizationEntrySchema);
