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
    // 選填：電話掛號時常常只問得到寵物名跟電話。報到時才必填——
    // 那一步要真的建立 Owner 文件，而 Owner.name 是必要欄位。
    ownerName: { type: String, default: '', trim: true },
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
    // 候診佇列中的位置，從 1 開始。它是「現在排第幾個」而不是報到時發的票號：
    // 離開佇列（完成／取消／未到）就清空，後面的人遞補。規則見 lib/appointmentQueue.js。
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
  { timestamps: true, optimisticConcurrency: true }
);

// 時間軸排序。
appointmentSchema.index({ scheduledAt: 1 });
// 依狀態篩選（例如把已取消/未到跟其餘分開），以及讀取當日候診佇列。
appointmentSchema.index({ status: 1, scheduledAt: 1 });
// 候診佇列「同一天不會有兩個相同位置」的最後一道防線。
//
// 重排本身是在 transaction 裡整批改寫佇列的，併發的重排會因為改到同一批文件而互相衝突；
// 擋不住的是「兩個人同時報到」——各自只寫自己那筆新文件，不會產生寫入衝突，
// 卻會算出同一個隊尾號碼。那種情況由這個索引擋下，路由收到 E11000 後重試。
//
// 只索引 arrived：離開佇列的人號碼是 null，而 null 不是 number，不會被這個索引管到。
appointmentSchema.index(
  { date: 1, checkinNumber: 1 },
  { unique: true, partialFilterExpression: { status: 'arrived', checkinNumber: { $type: 'number' } } }
);

export default mongoose.model('Appointment', appointmentSchema);
