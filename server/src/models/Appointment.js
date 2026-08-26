import mongoose from 'mongoose';

const appointmentSchema = new mongoose.Schema(
  {
    // 診所當天日期，來源真相；所有「哪一天」的查詢都以它為準。
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    // 選填：接電話時常常還沒決定精確時段，只是先卡一個「今天要來」。
    time: { type: String, default: '', trim: true },
    // date+time 換算出的實際時刻，只服務排序/範圍查詢，不是使用者輸入的來源真相。
    scheduledAt: { type: Date, required: true },

    // 有值＝連結到既有病患（回診）；null＝初診、尚未建檔。
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', default: null },
    petId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pet', default: null },

    // 一律存快照——不管是不是既有病患。查詢列表不用 populate 就能顯示，
    // 且飼主/寵物之後改名不會讓「當初電話裡登記的名字」跟著變。
    ownerName: { type: String, required: true, trim: true },
    ownerPhone: { type: String, default: '', trim: true },
    petName: { type: String, default: '', trim: true },
    species: { type: String, default: '', trim: true },

    reason: { type: String, default: '', trim: true },

    status: {
      type: String,
      enum: ['scheduled', 'arrived', 'completed', 'cancelled', 'no_show'],
      default: 'scheduled',
    },
    cancelReason: { type: String, default: '', trim: true, maxlength: 300 },
    // 報到當下配的當日看診序，從 1 開始、依報到先後排，前台可手動調整決定看診順序。
    checkinNumber: { type: Number, default: null },
    // 實際完成報到的時間。取消報到後清除，再次報到時重新記錄。
    checkedInAt: { type: Date, default: null },

    // 報到後量測的生命徵象，供候診時就地填寫的簡易門診表單使用；不回填任何 MedicalRecord，
    // 避免跟健檢報告的欄位混為一談（健檢表單類型只能在建立報告當下選一次，不存在
    // 「先建立報告、之後才補選類型」這條路，因此這裡先自己保管，等真正建立報告時
    // 才透過 /pets/:petId/records/new?fromAppointment= 轉過去）。
    weightKg: { type: Number, min: 0, default: null },
    temperatureC: { type: Number, min: 0, default: null },
    // 內部用途（藥品/費用等），不會出現在健檢報告裡。
    visitNote: { type: String, default: '', trim: true },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// 時間軸排序。
appointmentSchema.index({ scheduledAt: 1 });
// 依狀態篩選（例如把已取消/未到跟其餘分開），以及 checkinNumber 衝突檢查的當日範圍查詢。
appointmentSchema.index({ status: 1, scheduledAt: 1 });

export default mongoose.model('Appointment', appointmentSchema);
