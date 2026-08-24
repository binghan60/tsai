import mongoose from 'mongoose';
import { combineClinicDateTime } from '../lib/clinicTime.js';

const appointmentSchema = new mongoose.Schema(
  {
    // 診所當天日期，來源真相；所有「哪一天」的查詢都以它為準。
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    // 選填：接電話時常常還沒決定精確時段，只是先卡一個「今天要來」。
    time: { type: String, default: '', trim: true },
    // date+time 換算出的實際時刻，只服務排序/範圍查詢，不是使用者輸入的來源真相。
    scheduledAt: { type: Date, required: true },

    // 有值＝連結到既有病患；null＝初診、尚未建檔。
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', default: null },
    petId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pet', default: null },

    // 一律存快照——不管是不是既有病患。查詢列表不用 populate 就能顯示，
    // 且飼主/寵物之後改名不會讓「當初電話裡登記的名字」跟著變。
    ownerName: { type: String, required: true, trim: true },
    ownerPhone: { type: String, default: '', trim: true },
    petName: { type: String, default: '', trim: true },
    species: { type: String, default: '', trim: true },

    reason: { type: String, default: '', trim: true },
    notes: { type: String, default: '', trim: true },
    isSurgery: { type: Boolean, default: false },
    // 只在 isSurgery 為 true 時才有意義，不強制必填——接電話當下可能還沒問清楚術式名稱。
    surgeryName: { type: String, default: '', trim: true },

    status: {
      type: String,
      enum: ['scheduled', 'arrived', 'completed', 'cancelled', 'no_show'],
      default: 'scheduled',
    },
    cancelReason: { type: String, default: '', trim: true },
    // 報到當下配的當日看診序，從 1 開始、依報到先後排。只在轉成 arrived 時配號，
    // 撤銷報到（改回 scheduled）就清掉——之後重新報到要排在新的隊尾，不能沿用舊號。
    checkinNumber: { type: Number, default: null },
    // 轉出健檢報告後回填，只是「有沒有轉過」的旁證，不驅動任何 UI 邏輯。
    convertedRecordId: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicalRecord', default: null },
  },
  { timestamps: true }
);

appointmentSchema.pre('validate', function computeScheduledAt(next) {
  const scheduledAt = combineClinicDateTime(this.date, this.time || '00:00');
  if (scheduledAt) this.scheduledAt = scheduledAt;
  next();
});

// 當日列表排序。
appointmentSchema.index({ scheduledAt: 1 });
// 當日列表依狀態篩選；儀錶板「今日預約數」也是同一種 status 等值 + scheduledAt 範圍查詢。
appointmentSchema.index({ status: 1, scheduledAt: 1 });

export default mongoose.model('Appointment', appointmentSchema);
