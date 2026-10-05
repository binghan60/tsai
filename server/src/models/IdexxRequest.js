import mongoose from 'mongoose';

// 要送給 IDEXX 主機的報到／離院通知（lib/idexxCensus.js、lib/idexxRequests.js）。
// 雲端碰不到診所電腦的資料夾，所以先在這裡排隊；診所電腦上的抓檔程式每輪來拿（GET /api/lab-results/requests），
// 原封寫進 InterLink 的 Requests 資料夾後回報（POST /api/lab-results/requests/:id/delivered）。
// 一張掛號的到院、離院各一筆，也當作「上一次送了什麼」的紀錄，決定下一次要不要再送。
const idexxRequestSchema = new mongoose.Schema(
  {
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true },
    petId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pet', required: true },
    kind: { type: String, enum: ['in', 'out'], required: true },
    // 送出時的訊息種類；離院沿用到院那一份的種類，兩份才對得上。
    mode: { type: String, enum: ['census', 'work_request'], required: true },
    encoding: { type: String, enum: ['big5', 'utf-8'], required: true },
    messageId: { type: String, required: true },
    // 抓檔程式寫進 Requests 資料夾用的檔名（＝messageId.xml，跟 IDEXX 範例一樣）。
    fileName: { type: String, required: true },
    // 已經照 encoding 編好的檔案位元組，抓檔程式原封寫出、不必懂 XML。
    body: { type: Buffer, default: () => Buffer.alloc(0) },
    // Big5 沒有、被換成「?」的字（罕用字、表情符號），排查亂碼時看。
    unmappable: { type: [String], default: [] },
    // skipped：不必送出去、只記下「這一張已經收掉」——開單的檢驗已經做完（結果回來了），主機上那張單已經自己完成，不再送取消。
    status: { type: String, enum: ['pending', 'delivered', 'skipped'], default: 'pending' },
    deliveredAt: { type: Date, default: null },
    deliveredBy: { type: String, default: '' },
  },
  { timestamps: true }
);
idexxRequestSchema.index({ messageId: 1 }, { unique: true });
// 抓檔程式每輪拿待送的，舊到新。
idexxRequestSchema.index({ status: 1, createdAt: 1 });
// 找這張掛號上一次送了什麼。
idexxRequestSchema.index({ appointmentId: 1, createdAt: -1 });

export default mongoose.model('IdexxRequest', idexxRequestSchema);
