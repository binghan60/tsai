import mongoose from 'mongoose';

const appointmentSchema = new mongoose.Schema(
  {
    // 診所當天日期，來源真相；所有「哪一天」的查詢都以它為準。
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    // 選填：接電話時常常還沒決定精確時段，只是先卡一個「今天要來」。
    time: { type: String, default: '', trim: true },
    // 預估診療時間，以 15 分鐘為一格。
    estimatedDurationMinutes: { type: Number, default: 15, min: 15, max: 240 },
    // date+time 換算出的實際時刻，只服務排序/範圍查詢，不是使用者輸入的來源真相。
    scheduledAt: { type: Date, required: true },

    // 有值＝連結到既有病患（回診）；null＝初診、尚未建檔。
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', default: null },
    petId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pet', default: null },
    // 掛號當下的身分類型，之後報到替初診建立 petId 時也不能改寫。
    // 舊資料無法可靠回推，所以允許 null，前台遇到 null 就不顯示標籤。
    visitType: { type: String, enum: ['new', 'return'], default: null },

    // 一律存快照——不管是不是既有病患。查詢列表不用 populate 就能顯示，
    // 且飼主/貓咪之後改名不會讓「當初電話裡登記的名字」跟著變。
    // 選填：電話掛號時常常只問得到貓咪名跟電話。報到時才必填——
    // 那一步要真的建立 Owner 文件，而 Owner.name 是必要欄位。
    ownerName: { type: String, default: '', trim: true },
    ownerPhone: { type: String, default: '', trim: true },
    petName: { type: String, default: '', trim: true },
    species: { type: String, default: '', trim: true },

    reason: { type: String, default: '', trim: true },
    // 手術標記——獨立於 reason，勾選後 UI 會在候診佇列與工作台標註「手術」徽章。
    isSurgery: { type: Boolean, default: false },
    surgeryName: { type: String, default: '', trim: true, maxlength: 200 },
    // 掛號時指定、看診完成時用來直接建立草稿的表單。保留在掛號上，
    // 才不會因日後變更預設表單而讓已掛號病患用錯表單。
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'FormTemplate', default: null },
    recordId: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicalRecord', default: null },
    // 初診表可先送達、也可在現場填寫；實際報到時才選擇是否與這筆掛號連結。
    intakeSubmissionId: { type: mongoose.Schema.Types.ObjectId, ref: 'IntakeSubmission', default: null },
    // 固定初診 QR Code 的短驗證碼。只給初診掛號使用，表單成功送出後立即失效。
    intakeVerificationCode: { type: String, default: '', trim: true, match: /^$|^\d{4}$/ },
    intakeVerificationExpiresAt: { type: Date, default: null },
    intakeVerificationUsedAt: { type: Date, default: null },

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
    // 保證金（shared/deposit.js）：約這筆診時，這隻貓已經達到要收保證金的門檻，櫃台的決定記在這裡。
    // ''＝不需要收；collected＝已收（從這一刻起次數歸零重算）；waived＝這次不收（要有原因，不歸零）；
    // refunded＝這筆掛號取消時把保證金退了（不再歸零）；carried＝取消時先留著、後來沿用到下一筆掛號（錢記在那一筆上）。
    // 看診完之後的退還／抵扣不追蹤。
    depositStatus: { type: String, enum: ['', 'collected', 'waived', 'refunded', 'carried'], default: '' },
    depositWaiveReason: { type: String, default: '', trim: true, maxlength: 200 },
    depositDecidedAt: { type: Date, default: null },

    // 這次看診是看診資料的唯一存放處：體重、體溫、檢驗數值、本次紀錄、請轉告飼主、回診建議、
    // 內部備註與回診日期都只存在這裡。病歷日誌讀它即時組出來；報到時建立的健檢報告草稿
    // 不存這幾欄、直接引用這裡，在報告上改也是寫回這裡（結案時才凍結），見 lib/recordVisitLink.js。
    weightKg: { type: Number, min: 0, default: null },
    temperatureC: { type: Number, min: 0, default: null },
    // 檢驗數值（在健檢報告填寫頁輸入、寫回這裡）。項目來自掛號選的表單範本裡的檢驗區塊；存的時候連同名稱、單位、
    // 參考範圍一起存成快照，病歷日誌不必再讀範本就能組出「WBC 22.4 ↑」這種摘要。
    labValues: {
      type: [new mongoose.Schema({
        key: { type: String, required: true, trim: true },
        label: { type: String, required: true, trim: true },
        value: { type: String, default: '', trim: true, maxlength: 40 },
        unit: { type: String, default: '', trim: true },
        referenceMin: { type: Number, default: null },
        referenceMax: { type: Number, default: null },
      }, { _id: false })],
      default: [],
    },
    // 醫師或櫃台按下「送 IDEXX」的時間：這一刻才把貓咪送到 IDEXX 主機的待驗清單（lib/idexxCensus.js）。
    // 報到不自動送——預防針、拆線這類看診不驗血，全部送過去技術員反而要自己分辨。
    // 取消送 IDEXX、取消報到、取消掛號、標記未到時清成 null。
    labRequestedAt: { type: Date, default: null },
    // 診所電腦上的抓檔程式把通知寫進 IDEXX 主機的時間（它回報 delivered 時寫入）。比 labRequestedAt 晚才算「這一次」送到了：
    // 抓檔程式離線時通知只是排著隊，畫面要分得出「按了」跟「主機上看得到了」。不另外清空，重送時用時間先後判斷。
    labDeliveredAt: { type: Date, default: null },
    // 看診結束時約定的下次回診日。保留 date-only 字串，避免日期因伺服器時區偏移。
    followUpDate: { type: String, default: '', match: /^$|^\d{4}-\d{2}-\d{2}$/ },
    // 回診時間（選填，HH:MM）。沒填時併入 MedicalRecord.followUpDate 會落在當天 00:00。
    followUpTime: { type: String, default: '', match: /^$|^\d{2}:\d{2}$/ },
    // 回診原因——就是下一筆自動掛號的「來院原因」（Appointment.reason），
    // 不是這次看診本身的來院原因。沒填就用「回診」墊底。
    followUpReason: { type: String, default: '', trim: true },
    // 櫃台敲定回診時段時掛出的下一筆掛號（routes/appointmentWorkflow.js 的 followup）。
    // 之後改回診時段會就地改期這筆，只有它還是 scheduled 狀態才動；已經報到/完成/取消
    // 就是現場另外處理過了，不回頭改。
    followUpAppointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
    // 本次簡易紀錄的唯一來源；病歷日誌透過 appointmentId 讀取。飼主看不到，也不進健檢報告。
    visitNote: { type: String, default: '', trim: true },
    internalNote: { type: String, default: '', trim: true, maxlength: 2000 },
    // 面向飼主的照護提醒（例如「傷口勿舔舐」），由醫師填、櫃台當面轉告飼主。
    // 在櫃台處理視窗用警示樣式獨立呈現——這是最容易漏講的一件事。
    specialCareNote: { type: String, default: '', trim: true, maxlength: 500 },
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
appointmentSchema.index({ intakeVerificationCode: 1, intakeVerificationExpiresAt: 1 });
// 初診面板的「已發出的驗證碼」：只看還沒過期的，用到期時間當範圍條件。
appointmentSchema.index({ intakeVerificationExpiresAt: 1 });
// IDEXX 檢驗結果進來時找「這隻貓、檢驗當天」的看診（lib/labResultApply.js）。
appointmentSchema.index({ petId: 1, date: 1 });
// 出席紀錄的「飼主名下全部」：這位飼主所有貓的遲到與未到（lib/attendance.js）；只看一隻貓時用上面那個。
appointmentSchema.index({ ownerId: 1, date: 1 });
// 號碼牌可由櫃台自行決定，允許同日重複與再次使用；history 僅保留異動紀錄。

export default mongoose.model('Appointment', appointmentSchema);
