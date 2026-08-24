import mongoose from 'mongoose';

// 報告刪除時的稽核快照。
//
// 跟 deliveryLogs 同一套哲學：append-only、刻意不設 ref、把姓名與報告編號冗餘存下來。
// 理由也一樣——這筆紀錄的價值正是在原始資料消失之後還查得到。設了 ref 只會 populate
// 到一個已經不存在的文件；連 pet 都可能後來被刪掉，所以 petName／ownerName 也要當場抄。
//
// snapshot 存的是刪除當下 MedicalRecord 的完整內容（含結案時凍結的 sections）。
// 型別給 Mixed 是刻意的：範本結構由使用者自訂，這裡不該再定義一次它長什麼樣，
// 而且快照的意義就是「當時原封不動的樣子」，不是「符合今天 schema 的樣子」。
const deletedMedicalRecordSchema = new mongoose.Schema(
  {
    recordId: { type: mongoose.Schema.Types.ObjectId, required: true },
    reportNumber: { type: String, trim: true },
    petId: { type: mongoose.Schema.Types.ObjectId },
    petName: { type: String, trim: true },
    ownerName: { type: String, trim: true },
    vet: { type: String, trim: true },
    visitDate: { type: Date },
    examType: { type: String, trim: true },
    // 刪除當下的生命週期與寄送狀態。留著是為了回答「這份被刪的報告，當時走到哪一步」。
    status: { type: String, trim: true },
    deliveryStatus: { type: String, trim: true },
    reportVersion: { type: Number },
    snapshot: { type: mongoose.Schema.Types.Mixed },
    deletedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

// 清單一律依刪除時間倒序；_id 是穩定的第二排序鍵，避免同一毫秒刪除多筆時分頁跳號。
deletedMedicalRecordSchema.index({ deletedAt: -1, _id: -1 });
// 依原報告回查「這份報告是不是被刪了」。
deletedMedicalRecordSchema.index({ recordId: 1 });

export default mongoose.model('DeletedMedicalRecord', deletedMedicalRecordSchema, 'deletedMedicalRecords');
