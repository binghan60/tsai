import mongoose from 'mongoose';

// 掛號日誌與藥單日誌都只存關聯、內容由來源文件即時組成，所以 content 不必填。
const DERIVED_SOURCES = ['appointment', 'medication'];

const clinicalNoteSchema = new mongoose.Schema(
  {
    petId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pet', required: true },
    entryDate: { type: Date, required: true, default: Date.now },
    content: {
      type: String,
      required() {
        if (this instanceof mongoose.Query) return !DERIVED_SOURCES.includes(this.getUpdate()?.$set?.source);
        return !this.appointmentId && !this.medicationOrderId;
      },
      trim: true,
    },
    source: { type: String, enum: ['manual', 'legacy_import', 'appointment', 'medication'], default: 'manual' },
    // 掛號日誌只存關聯，內容由掛號即時組成；其餘來源一律是 null。
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
    // 藥單（領藥紀錄）日誌：跟掛號日誌是各自獨立的兩筆，內容由藥單即時組成，藥單取消時一併刪除。
    medicationOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicationOrder', default: null },
  },
  { timestamps: true }
);

clinicalNoteSchema.index({ petId: 1, entryDate: -1, _id: -1 });
// 一筆掛號最多同步一筆日誌。
clinicalNoteSchema.index(
  { appointmentId: 1 },
  { unique: true, partialFilterExpression: { appointmentId: { $type: 'objectId' } } }
);
// 一張藥單最多同步一筆日誌。
clinicalNoteSchema.index(
  { medicationOrderId: 1 },
  { unique: true, partialFilterExpression: { medicationOrderId: { $type: 'objectId' } } }
);

export default mongoose.model('ClinicalNote', clinicalNoteSchema);
