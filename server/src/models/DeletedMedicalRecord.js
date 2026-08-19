import mongoose from 'mongoose';

// 報告刪除時的稽核快照，供之後回溯查詢或還原用。
// 只在報告從 medicalRecords 移除的當下寫一筆，之後不會再被更新，
// 所以整份原始文件直接存成 Mixed，不必另外維護一份 schema 跟著原表同步變動。
const deletedMedicalRecordSchema = new mongoose.Schema(
  {
    originalId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    petId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pet', required: true },
    reportNumber: { type: String, default: '' },
    status: { type: String, default: '' },
    deliveryStatus: { type: String, default: '' },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    deletedAt: { type: Date, default: Date.now },
    // 還原過的紀錄留在這張表當歷史紀錄，但不再出現在回收桶清單裡。
    restoredAt: { type: Date, default: null },
  },
  { timestamps: false }
);

export default mongoose.model('DeletedMedicalRecord', deletedMedicalRecordSchema);
