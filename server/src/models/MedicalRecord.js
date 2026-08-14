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
    group: { type: String, required: true },
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

    shareToken: { type: String, default: uuidv4, unique: true },
    shareEnabled: { type: Boolean, default: false },
    sharedAt: { type: Date, default: null },
    status: {
      type: String,
      // `sent` 僅保留給既有資料相容；新流程使用 finalized + deliveryStatus。
      enum: ['draft', 'finalized', 'sent'],
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

export default mongoose.model('MedicalRecord', medicalRecordSchema);
