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
    // 掛號當下的身分類型，之後報到替初診建立 petId 時也不能改寫。
    // 舊資料無法可靠回推，所以允許 null，前台遇到 null 就不顯示標籤。
    visitType: { type: String, enum: ['new', 'return'], default: null },

    // 一律存快照——不管是不是既有病患。查詢列表不用 populate 就能顯示，
    // 且飼主/寵物之後改名不會讓「當初電話裡登記的名字」跟著變。
    // 選填：電話掛號時常常只問得到寵物名跟電話。報到時才必填——
    // 那一步要真的建立 Owner 文件，而 Owner.name 是必要欄位。
    ownerName: { type: String, default: '', trim: true },
    ownerPhone: { type: String, default: '', trim: true },
    petName: { type: String, default: '', trim: true },
    species: { type: String, default: '', trim: true },

    reason: { type: String, default: '', trim: true },
    // 掛號時指定、看診完成時用來直接建立草稿的表單。保留在掛號上，
    // 才不會因日後變更預設表單而讓已掛號病患用錯表單。
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'FormTemplate', default: null },
    recordId: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicalRecord', default: null },

    status: {
      type: String,
      enum: ['scheduled', 'arrived', 'pending_checkout', 'completed', 'cancelled', 'no_show'],
      default: 'scheduled',
    },
    cancelReason: { type: String, default: '', trim: true, maxlength: 300 },
    // 報到後交給病患的實體號碼牌。它只用於現場辨識與叫號，不代表陣列位置。
    // 離開候診後 checkinNumber 清空，但當天已發過的號碼保留在 history，避免再次叫到同號。
    checkinNumber: { type: Number, default: null },
    checkinNumberHistory: { type: [Number], default: [] },
    // 實際完成報到的時間。取消報到後清除，再次報到時重新記錄。
    checkedInAt: { type: Date, default: null },
    latenessMinutes: { type: Number, default: 0, min: 0, max: 1440 },

    // 報到後量測的生命徵象，供候診時就地填寫的簡易門診表單使用；不回填任何 MedicalRecord，
    // 避免跟健檢報告的欄位混為一談（健檢表單類型只能在建立報告當下選一次，不存在
    // 「先建立報告、之後才補選類型」這條路，因此這裡先自己保管，等真正建立報告時
    // 才透過 /pets/:petId/records/new?fromAppointment= 轉過去）。
    weightKg: { type: Number, min: 0, default: null },
    temperatureC: { type: Number, min: 0, default: null },
    // 看診結束時約定的下次回診日。保留 date-only 字串，避免日期因伺服器時區偏移。
    followUpDate: { type: String, default: '', match: /^$|^\d{4}-\d{2}-\d{2}$/ },
    // 回診時間（選填，HH:MM）。沒填時併入 MedicalRecord.followUpDate 會落在當天 00:00。
    followUpTime: { type: String, default: '', match: /^$|^\d{2}:\d{2}$/ },
    // 回診原因——就是下一筆自動掛號的「來院原因」（Appointment.reason），
    // 不是這次看診本身的來院原因。沒填就用「回診」墊底。
    followUpReason: { type: String, default: '', trim: true },
    // 完成看診時依 followUpDate/followUpTime 自動掛出的下一筆掛號。之後改回診日期會回頭
    // 同步這筆（見 routes/appointments.js 的 syncFollowUpAppointment），只有它還是 scheduled
    // 狀態才動；已經報到/完成/取消就是現場已經另外處理過了，不回頭改。
    followUpAppointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
    // 本次簡易紀錄：醫師寫的病歷內容，跟 clinicalNotes（病歷日誌）雙向同步，見
    // routes/appointmentWorkflow.js 與 routes/clinicalNotes.js。飼主看不到，也不進健檢報告。
    visitNote: { type: String, default: '', trim: true },
    // 面向飼主的照護提醒（例如「傷口勿舔舐」），由醫師填、櫃台當面轉告飼主。
    // 跟 handoffNote（櫃台的作業指示）語意分開，才能在櫃台端用警示樣式獨立呈現——
    // 這是最容易漏講的一件事。刻意不跟 clinicalNotes 同步，單一資料來源留在這裡。
    specialCareNote: { type: String, default: '', trim: true, maxlength: 500 },
    // 給櫃台的交辦：收費項目、領藥、要開的證明都寫這裡，取代了早期逐項計價的批價清單。
    // 系統不解析內容、不計價也不記金額——櫃台讀這段文字自行收費。
    handoffNote: { type: String, default: '', trim: true, maxlength: 1000 },
    followUpRecommendation: { type: String, default: '', trim: true, maxlength: 500 },

    // 流水線的三個里程碑，見 shared/appointmentWorkflow.js。status 由它們推導出來，
    // 不是另一個獨立的真相。workflowVersion 2 ＝這條四步流水線；1 是舊的批價／收款版本，
    // 那些欄位已從 schema 移除、讀不回來，改由 status 回推階段。
    workflowVersion: { type: Number, default: 0 },
    // 醫師開啟工作區＝開始看診。
    visitStartedAt: { type: Date, default: null },
    // 醫師「完成看診，送交櫃台」。取回（reclaim）會清成 null，讓這筆退回看診中。
    handoffAt: { type: Date, default: null },
    // 櫃台「完成處理」。寫入後就是終態，不能再取回。
    deskCompletedAt: { type: Date, default: null },
    // 醫師對已結案就診提出的重新開啟申請；保留原因與時間，櫃台核准後才可再修改。
    reopenRequest: {
      reason: { type: String, default: '', trim: true, maxlength: 500 },
      requestedAt: { type: Date, default: null },
      approvedAt: { type: Date, default: null },
    },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, optimisticConcurrency: true }
);

// 時間軸排序。
appointmentSchema.index({ scheduledAt: 1 });
// 依狀態篩選（例如把已取消/未到跟其餘分開），以及讀取當日候診佇列。
appointmentSchema.index({ status: 1, scheduledAt: 1 });
// 同一天仍持有號碼牌的人不能同時持有相同的實體號碼牌。兩人同時報到可能算到同一張
// 可用牌號，由這個索引擋下後讓報到流程重試；離開候診的人號碼會清空，不受索引管理。
// pending_checkout（醫師已交櫃台、櫃台還沒處理完）人還在診所、還沒歸還號碼牌，一併納入保護範圍，
// 見 lib/appointmentStatus.js 的 holdsCheckinNumber。
appointmentSchema.index(
  { date: 1, checkinNumber: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['arrived', 'pending_checkout'] }, checkinNumber: { $type: 'number' } },
  }
);
// 同一天每個紙本牌號只能發出一次；即使已完成、取消報到或中途改號，舊號仍由 history 保留。
appointmentSchema.index(
  { date: 1, checkinNumberHistory: 1 },
  { unique: true, partialFilterExpression: { checkinNumberHistory: { $type: 'number' } } }
);

export default mongoose.model('Appointment', appointmentSchema);
