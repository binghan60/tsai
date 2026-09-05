import mongoose from 'mongoose';

const clinicalNoteSchema = new mongoose.Schema(
  {
    petId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pet', required: true },
    entryDate: { type: Date, required: true, default: Date.now },
    content: { type: String, required: true, trim: true },
    source: { type: String, enum: ['manual', 'legacy_import', 'appointment'], default: 'manual' },
    // source: 'appointment' 這筆日誌跟掛號的 visitNote 是同一份資料，靠這個欄位互相同步；
    // 其餘來源一律是 null。
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
  },
  { timestamps: true }
);

clinicalNoteSchema.index({ petId: 1, entryDate: -1, _id: -1 });
// 一筆掛號最多同步一筆日誌。
clinicalNoteSchema.index(
  { appointmentId: 1 },
  { unique: true, partialFilterExpression: { appointmentId: { $type: 'objectId' } } }
);

export default mongoose.model('ClinicalNote', clinicalNoteSchema);
