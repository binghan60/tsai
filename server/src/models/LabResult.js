import mongoose from 'mongoose';

// IDEXX 院內檢驗儀的結果，由診所電腦上的抓檔程式把 InterLink 存下的 XML 上傳進來（見 lib/idexxResult.js）。
// 一筆＝一台儀器對一隻貓的一次檢驗；同一次看診跑了生化又跑血球，會是 diagnosticSetId 相同、instrument 不同的兩筆。
// petId 是空的＝還沒有人確認這是哪隻貓（待配對）；歸檔之後才有值。
const assaySchema = new mongoose.Schema(
  {
    code: { type: String, required: true },
    // 一律存字串：SNAP 是 Positive／Negative，inVue 是整句判讀。
    value: { type: String, default: '' },
    unit: { type: String, default: '' },
    referenceMin: { type: Number, default: null },
    referenceMax: { type: Number, default: null },
    criticalMin: { type: Number, default: null },
    criticalMax: { type: Number, default: null },
    qualifier: { type: String, default: '' },
  },
  { _id: false }
);

const personSchema = { firstName: { type: String, default: '' }, lastName: { type: String, default: '' } };

const labResultSchema = new mongoose.Schema(
  {
    diagnosticSetId: { type: String, required: true },
    instrument: { type: String, required: true },
    subType: { type: String, default: '' },
    messageId: { type: String, default: '' },
    messageAt: { type: Date, default: null },
    requisitionNumber: { type: String, default: '' },
    runAt: { type: Date, default: null },
    // 以下是 IDEXX 主機上登記的資料，原樣保留給人配對時參考，不一定跟我們的飼主／貓咪資料一致。
    client: { id: { type: String, default: '' }, ...personSchema },
    patient: {
      // IDEXX 主機回傳的病患編號（報到時我們送過去的才會對得上），不是 petId。
      id: { type: String, default: '' },
      name: { type: String, default: '' },
      species: { type: String, default: '' },
      gender: { type: String, default: '' },
      breed: { type: String, default: '' },
      birthDate: { type: String, default: null },
      weight: {
        type: new mongoose.Schema({ value: Number, unit: String }, { _id: false }),
        default: null,
      },
    },
    doctor: personSchema,
    assays: { type: [assaySchema], default: [] },
    // 醫師在病歷日誌改過的數值（代號 → 改後的值）。assays 是儀器原文、不動；顯示與日誌用 shared/labValues.js 的 effectiveAssays 疊上去。
    overrides: { type: [new mongoose.Schema({ code: { type: String, required: true }, value: { type: String, required: true } }, { _id: false })], default: [] },
    notes: { type: [String], default: [] },
    // 原始檔留著：解析規則之後修正了，可以從原檔重新解析，不必回診所找檔案。
    rawXml: { type: String, required: true, select: false },
    fileName: { type: String, default: '' },
    receiveCount: { type: Number, default: 1 },
    lastReceivedAt: { type: Date, default: Date.now },
    // IDEXX 事後送了內容不同的更正版（Replace_Previous_Results 等）就記下時間，已歸檔的要提醒人重看。
    revisedAt: { type: Date, default: null },
    petId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pet', default: null },
    matchedAt: { type: Date, default: null },
    // patient_id：IDEXX 帶回報到時送出的貓咪編號，自動認出；manual：人在待確認清單（工具欄「檢驗」）選的。
    matchSource: { type: String, enum: ['patient_id', 'manual', null], default: null },
    // 自動填進哪一次看診（lib/labResultApply.js）。appliedAt 是填入的時間；找不到看診就留空、之後可以再套用。
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
    appliedAt: { type: Date, default: null },
    // 填了哪些欄位、填了什麼值。復原（選錯貓）時只清「現在還是這個值」的欄位——被人改過的不動。
    filled: {
      type: [new mongoose.Schema({ key: String, label: String, value: String }, { _id: false })],
      default: [],
    },
    // 看診上已經有人填了不同的值，沒有蓋掉——給醫師看、自己決定要不要換。
    conflicts: {
      type: [new mongoose.Schema({ key: String, label: String, current: String, idexx: String }, { _id: false })],
      default: [],
    },
    // conflicts 還沒有人處理（「檢驗」面板與健檢報告會跳出比對視窗，選覆蓋或保留後關掉）。
    conflictsOpen: { type: Boolean, default: false },
    conflictsResolvedAt: { type: Date, default: null },
    // 表單裡沒有對應 IDEXX 代號的項目；一直出現在這裡代表表單設計頁的代號還沒設。
    unmappedCodes: { type: [String], default: [] },
    // 忽略：IDEXX 的品管測試（QC）、練習用的檢驗，不是任何一隻貓的，從待確認清單拿掉。
    dismissedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
// 同一次檢驗重送、更正都沿用同一組識別碼，用它判斷「這份已經收過」。
labResultSchema.index({ diagnosticSetId: 1, instrument: 1 }, { unique: true });
// 待配對清單（petId: null）與貓咪詳情頁都依檢驗時間新到舊；_id 是同一時間的排序依據，
// 放進索引才不會變成記憶體排序（32MB 上限）。
labResultSchema.index({ petId: 1, runAt: -1, _id: -1 });
// 還沒處理的數值差異（「檢驗」面板、健檢報告打開時查）；只收有開著的那幾筆。
labResultSchema.index({ appointmentId: 1 }, { partialFilterExpression: { conflictsOpen: true } });
// 病歷日誌讀「連到這次看診的結果」（lib/appointmentJournal.js 的 linkedLabResults）；沒連到看診的不收。
labResultSchema.index({ appointmentId: 1, runAt: 1, _id: 1 }, { partialFilterExpression: { appointmentId: { $type: 'objectId' } } });

export default mongoose.model('LabResult', labResultSchema);
