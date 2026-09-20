import mongoose from 'mongoose';
import { MEDICATION_STAGES } from '../../../shared/medicationWorkflow.js';

const schema = new mongoose.Schema({
  petId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pet', required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', required: true },
  appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
  petName: { type: String, required: true },
  ownerName: { type: String, default: '' },
  ownerPhone: { type: String, default: '' },
  medicalRecordNumber: { type: String, default: '' },
  condition: { type: String, default: '', maxlength: 5000 },
  prescription: { type: String, default: '', maxlength: 10000 },
  note: { type: String, default: '', maxlength: 3000 },
  storageLocation: { type: String, default: '', maxlength: 200 },
  status: { type: String, enum: MEDICATION_STAGES.map(stage => stage.key), default: 'review' },
  needsRepack: { type: Boolean, default: false },
  approvedBy: { type: String, default: '' },
  approvedAt: { type: Date, default: null },
  packedBy: { type: String, default: '' },
  packedAt: { type: Date, default: null },
  collectedAt: { type: Date, default: null },
  history: [{
    _id: false,
    action: String,
    actor: String,
    at: Date,
    from: String,
    to: String,
    reason: String,
    // 每次異動留當時內容，醫師修改前後皆可追溯。
    condition: String,
    prescription: String,
    note: String,
    storageLocation: String,
  }],
}, { timestamps: true, optimisticConcurrency: true });

schema.index({ status: 1, createdAt: -1 });
schema.index({ petId: 1, createdAt: -1 });
export default mongoose.model('MedicationOrder', schema);
