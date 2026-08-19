import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

function createReportNumber() {
  const objectId = this?._id;
  const year = objectId?.getTimestamp?.().getFullYear() || new Date().getFullYear();
  const suffix = objectId?.toString().slice(-8).toUpperCase() || uuidv4().slice(0, 8).toUpperCase();
  return `HC-${year}-${suffix}`;
}

const examinationFindingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    status: { type: String, enum: ['not_checked', 'normal', 'abnormal'], default: 'not_checked' },
    note: { type: String, default: '' },
  },
  { _id: false }
);

const measurementAssessmentSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    status: { type: String, enum: ['not_checked', 'normal', 'abnormal'], default: 'not_checked' },
    statusSource: { type: String, enum: ['manual', 'auto'], default: 'auto' },
    unit: { type: String, default: '' },
    referenceMin: { type: Number, default: null },
    referenceMax: { type: Number, default: null },
  },
  { _id: false }
);

const labFindingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    // Mongoose 對 String 的 required 會把 '' 判成未填。分組只是報告上的分群標題，
    // 未分組是合法狀態，設 required 會讓範本裡沒填分組的檢驗項目整份報告存不進去。
    group: { type: String, default: '' },
    status: { type: String, enum: ['not_checked', 'normal', 'abnormal'], default: 'not_checked' },
    statusSource: { type: String, enum: ['manual', 'auto'], default: 'manual' },
    value: { type: String, default: '' },
    unit: { type: String, default: '' },
    referenceMin: { type: Number, default: null },
    referenceMax: { type: Number, default: null },
    note: { type: String, default: '' },
  },
  { _id: false }
);

// 報告結案時，把當下的表單結構與作答一起存成快照。
// 之後改範本不會回頭改動已結案的報告 —— 病歷必須永遠呈現當時的樣子。
const reportSectionItemSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, required: true },
    role: { type: String, default: null },
    group: { type: String, default: '' },
    unit: { type: String, default: '' },
    span: { type: String, default: 'auto' },
    value: { type: mongoose.Schema.Types.Mixed, default: '' },
    status: { type: String, default: null },
    statusSource: { type: String, default: null },
    referenceMin: { type: Number, default: null },
    referenceMax: { type: Number, default: null },
    note: { type: String, default: '' },
    numeric: { type: Boolean, default: true },
    required: { type: Boolean, default: false },
  },
  { _id: false }
);

const reportSectionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    presentation: { type: String, default: 'keyValue' },
    order: { type: Number, default: 0 },
    items: { type: [reportSectionItemSchema], default: [] },
  },
  { _id: false }
);

const medicalRecordSchema = new mongoose.Schema(
  {
    petId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pet', required: true },
    reportNumber: { type: String, default: createReportNumber, trim: true },
    vet: { type: String, default: '', trim: true },
    visitDate: { type: Date, default: null },
    examType: { type: String, default: '例行健檢', trim: true },

    // 基本量測
    weightKg: { type: Number, min: 0, default: null },
    temperatureC: { type: Number, min: 0, default: null },
    heartRate: { type: Number, min: 0, default: null },
    respiratoryRate: { type: Number, min: 0, default: null },
    bodyConditionScore: { type: Number, min: 1, max: 9, default: null },
    measurementAssessments: { type: [measurementAssessmentSchema], default: [] },
    examinationFindings: { type: [examinationFindingSchema], default: [] },
    labFindings: { type: [labFindingSchema], default: [] },
    labSummary: { type: String, default: '' },

    // 病人陳述
    chiefComplaint: { type: String, default: '' },
    history: { type: String, default: '' },

    // 醫生判斷
    diagnosis: { type: String, default: '' },
    treatmentPlan: { type: String, default: '' },
    conclusion: { type: String, default: '' },
    other: { type: String, default: '' },

    // 使用者自訂項目的作答。內建項目仍存在上方的具名欄位，
    // 自訂項目沒有對應欄位，一律收在這裡（key 就是範本項目的 key）。
    customValues: { type: Map, of: mongoose.Schema.Types.Mixed, default: () => new Map() },

    // 結案時寫入；草稿為空，報告頁會即時用目前範本組合。
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'FormTemplate', default: null },
    templateVersion: { type: Number, default: null },
    sections: { type: [reportSectionSchema], default: [] },

    shareToken: { type: String, default: uuidv4, unique: true },
    shareEnabled: { type: Boolean, default: false },
    sharedAt: { type: Date, default: null },
    status: {
      type: String,
      // 寄送狀態獨立記在 deliveryStatus，不佔用生命週期狀態。
      enum: ['draft', 'finalized'],
      default: 'draft',
    },
    finalizedAt: { type: Date, default: null },
    pdfGeneratedAt: { type: Date, default: null },
    reportVersion: { type: Number, min: 1, default: 1 },
    revisionOf: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicalRecord', default: null },
    revisionRootId: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicalRecord', default: null },
    revisionReason: { type: String, trim: true, default: '' },
    supersededBy: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicalRecord', default: null },
    deliveryStatus: {
      type: String,
      enum: ['not_sent', 'sending', 'sent', 'failed'],
      default: 'not_sent',
    },
    deliveryError: { type: String, trim: true, default: '' },
    lastDeliveryAttemptAt: { type: Date, default: null },
    sentAt: { type: Date },
    sentTo: { type: String, trim: true, default: undefined },
    emailMessageId: { type: String, trim: true, default: undefined },
  },
  { timestamps: true }
);

medicalRecordSchema.index({ petId: 1 });
medicalRecordSchema.index({ reportNumber: 1 }, { unique: true, sparse: true });

// 以下兩個是給跨寵物的健檢紀錄清單（GET /api/records）用的。
//
// 沒有它們的話那支查詢是 COLLSCAN + 記憶體排序：不只是慢，MongoDB 的記憶體排序
// 有 32MB 硬上限，超過會直接丟 Sort exceeded memory limit，整個清單頁打不開。
// 報告帶著 sections 快照，單筆不小，累積起來撞得到這條線。
//
// 欄位順序照 ESR：等值比對的 supersededBy 在前，排序用的 updatedAt 在後——
// 這樣 MongoDB 直接照索引順序讀，連排序這個步驟都不需要。
medicalRecordSchema.index({ supersededBy: 1, updatedAt: -1 });
// 佇列篩選（草稿／待寄送／寄送失敗）。
medicalRecordSchema.index({ status: 1, deliveryStatus: 1 });

export default mongoose.model('MedicalRecord', medicalRecordSchema);
