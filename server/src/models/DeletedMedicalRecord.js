import mongoose from 'mongoose';

// 報告刪除時的稽核快照，供之後回溯查詢用（目前沒有還原介面，需要復原時直接查這張表）。
// 只在報告從 medicalRecords 移除的當下寫一筆，之後不會再被更新，
// 所以整份原始文件直接存成 Mixed，不必另外維護一份 schema 跟著原表同步變動。
const deletedMedicalRecordSchema = new mongoose.Schema(
  {
    originalId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
    petId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pet', required: true },
    reportNumber: { type: String, default: '' },
    status: { type: String, default: '' },
    deliveryStatus: { type: String, default: '' },
    petName: { type: String, default: '' },
    examType: { type: String, default: '' },
    visitDate: { type: Date, default: null },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    deletedAt: { type: Date, default: Date.now },
    restoredAt: { type: Date, default: null },
    restoreCount: { type: Number, default: 0 },
  },
  { timestamps: false }
);

deletedMedicalRecordSchema.index({ restoredAt: 1, deletedAt: -1 });

export default mongoose.model('DeletedMedicalRecord', deletedMedicalRecordSchema);
