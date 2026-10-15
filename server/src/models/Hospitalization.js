import mongoose from 'mongoose';

// 住院單：一次住院。一律從看診收住院（admittingAppointmentId，看診到一半才決定住院很常見），
// 入院那次看診的量測、紀錄、檢驗就是入院評估——住院專區直接引用，不複製。
// 每天一筆體重在 hospitalizationDays，照護紀錄（紙本那張表的一格）在 hospitalizationEntries。
const hospitalizationSchema = new mongoose.Schema(
  {
    petId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pet', required: true },
    admittingAppointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true },
    // admitted 住院中／discharged 已出院／cancelled 收錯了（只有還沒記任何紀錄時能取消，見 routes/hospitalizations.js）。
    status: { type: String, enum: ['admitted', 'discharged', 'cancelled'], default: 'admitted' },
    admittedAt: { type: Date, required: true },
    dischargedAt: { type: Date, default: null },
    reason: { type: String, default: '', trim: true, maxlength: 200 },
    dischargeNote: { type: String, default: '', trim: true, maxlength: 2000 },
    // 出院時「帶回家的藥」開成的那張藥單（直接是待包藥）。
    dischargeMedicationOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicationOrder', default: null },
  },
  { timestamps: true, optimisticConcurrency: true }
);

// 住院清單（住院中依入院時間、已出院依出院時間）、總覽的「住院中」數字。
hospitalizationSchema.index({ status: 1, admittedAt: 1 });
hospitalizationSchema.index({ status: 1, dischargedAt: -1, _id: -1 });
// 貓咪頁的住院頁籤、IDEXX 認貓（檢驗時間落在哪一次住院）。
hospitalizationSchema.index({ petId: 1, admittedAt: -1 });
// 一次看診最多收一次住院（取消的不算，取消後可以重收）。
hospitalizationSchema.index(
  { admittingAppointmentId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['admitted', 'discharged'] } } }
);

export default mongoose.model('Hospitalization', hospitalizationSchema);
