import mongoose from 'mongoose';
import { richTextMaxLength } from '../lib/richTextSchema.js';

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
    // 掛號當下的身分類型（後端依有沒有連結既有貓咪決定）。初診表核准後補上 petId 也不改寫——
    // 那一筆整天都還是「初診」。
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
    // 掛號時指定、報到時用來建立健檢報告草稿的表單。保留在掛號上，
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
    // 取消掛號的時刻（恢復掛號時清掉）。貓咪詳情頁「出席紀錄」列已取消的掛號時顯示。
    cancelledAt: { type: Date, default: null },
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
    // 櫃台敲定回診時段時掛出的下一筆掛號（routes/appointmentWorkflow.js 的 followup）。
    // 之後改回診時段會就地改期這筆，只有它還是 scheduled 狀態才動；已經報到/完成/取消
    // 就是現場另外處理過了，不回頭改。
    followUpAppointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
    // 反方向：這筆是哪一次看診約出來的回診。它被取消或刪除時，那次看診才知道要回到「待安排回診」（routes/appointments.js 的 syncFollowUpParent）。
    followUpOfId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
    // 本次簡易紀錄的唯一來源；病歷日誌透過 appointmentId 讀取。飼主看不到，也不進健檢報告。
    visitNote: { type: String, default: '', trim: true },
    // 醫師在診療台寫的藥單（可上色、加粗，字數算純文字）。會進病歷日誌的「藥單」一列；
    // 送交櫃台時依它建立／更新一張藥單（lib/visitMedicationOrder.js），那張藥單的 id 記在 medicationOrderId。
    prescription: { type: String, default: '', trim: true, validate: richTextMaxLength(10000) },
    medicationOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicationOrder', default: null },
    internalNote: { type: String, default: '', trim: true, maxlength: 2000 },
    // 櫃台處理視窗「本次簡易紀錄」區的勾選框：這次看診有影像要上傳。勾了會出現在病歷日誌，
    // 並新增一筆院內待辦（lib/imageUploadTodo.js），那筆待辦的 id 記在 imageUploadTodoId——
    // 取消勾選時才知道要收掉哪一筆。三種值：null＝從來沒勾過（日誌不列）、true＝是、false＝勾過又取消（日誌列「否」）。
    imageUpload: { type: Boolean, default: null },
    imageUploadTodoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Todo', default: null },
    // 那筆待辦被完成的時間（routes/todos.js 完成／改回未完成時寫回來），日誌上顯示「已完成」與時間。
    // 存在掛號上而不是讀取時去查待辦：待辦之後被刪掉，日誌上的完成紀錄還在。
    imageUploadDoneAt: { type: Date, default: null },
    // 面向飼主的照護提醒（例如「傷口勿舔舐」），由醫師填、櫃台當面轉告飼主。
    // 在櫃台處理視窗用警示樣式獨立呈現——這是最容易漏講的一件事。
    specialCareNote: { type: String, default: '', trim: true, maxlength: 500 },
    followUpRecommendation: { type: String, default: '', trim: true, maxlength: 500 },

    // 流水線的三個里程碑，見 shared/appointmentWorkflow.js。status 由它們推導出來，不是另一個獨立的真相。
    // 醫師按「看診」／「開始看診」。點開工作區只是先看資料，不算；「取消看診」會清成 null、退回候診。
    visitStartedAt: { type: Date, default: null },
    // 醫師「完成看診，送交櫃台」。取回（reclaim）會清成 null，讓這筆退回看診中。
    handoffAt: { type: Date, default: null },
    // 櫃台「完成處理」。寫入後醫師不能再取回；要改得由櫃台退回處理中（或核准醫師的修改申請），那時清成 null。
    deskCompletedAt: { type: Date, default: null },
    // 醫師對已完成的就診提出的修改申請；保留原因與時間，櫃台核准後才可再修改。
    reopenRequest: {
      reason: { type: String, default: '', trim: true, maxlength: 500 },
      requestedAt: { type: Date, default: null },
      approvedAt: { type: Date, default: null },
    },
  },
  { timestamps: true, optimisticConcurrency: true }
);

// 某一天的時間軸：診療台、掛號台、總覽與配號碼牌都是「這一天的全部掛號」，每台裝置每 30 秒輪詢一次。
appointmentSchema.index({ date: 1, scheduledAt: 1 });
// 跨日搜尋與待確認檢驗的候選掛號依時間排序。
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
// 「上傳影像」帶出來的待辦完成時，反查是哪一筆掛號（lib/imageUploadTodo.js）。絕大多數掛號沒有這個欄位。
appointmentSchema.index({ imageUploadTodoId: 1 }, { partialFilterExpression: { imageUploadTodoId: { $type: 'objectId' } } });
// 診療台開出的藥單之後在藥單那邊被修改或取消時，反查是哪一筆掛號（lib/visitMedicationOrder.js）。
appointmentSchema.index({ medicationOrderId: 1 }, { partialFilterExpression: { medicationOrderId: { $type: 'objectId' } } });
// 健檢報告草稿反查連著的看診：填寫頁每次讀取與自動存檔都會查（lib/recordVisitLink.js）。
appointmentSchema.index({ recordId: 1 }, { partialFilterExpression: { recordId: { $type: 'objectId' } } });
// 號碼牌刻意沒有唯一索引：櫃台可以改成手上實際發出去的號碼，同一天允許重複。

export default mongoose.model('Appointment', appointmentSchema);
