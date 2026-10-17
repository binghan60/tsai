import mongoose from 'mongoose';
import { MEDICATION_STAGES } from '../../../shared/medicationWorkflow.js';
import { richTextMaxLength } from '../lib/richTextSchema.js';

const schema = new mongoose.Schema({
  petId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pet', required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', required: true },
  appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
  // 醫師在診療台開的（看診送交櫃台時建立，lib/visitMedicationOrder.js）：內容已經在那次看診的病歷日誌上，
  // 不另外產生領藥日誌；之後在藥單這邊修改或取消會寫回那次看診。
  fromVisit: { type: Boolean, default: false },
  // 出院時「帶回家的藥」開的（routes/hospitalizations.js 的出院）：醫師開的、直接是待包藥，有自己的領藥日誌。
  hospitalizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospitalization', default: null },
  // 住院時在照護紀錄「開藥」開的（lib/entryMedicationOrder.js）：醫師開的、直接是待包藥，有自己的領藥日誌；
  // 修改或取消會寫回那一格照護紀錄。
  hospitalizationEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'HospitalizationEntry', default: null },
  petName: { type: String, required: true },
  ownerName: { type: String, default: '' },
  ownerPhone: { type: String, default: '' },
  // 可以上色、加粗（shared/richText.js），字數上限算純文字。
  condition: { type: String, default: '', validate: richTextMaxLength(5000) },
  prescription: { type: String, default: '', validate: richTextMaxLength(10000) },
  note: { type: String, default: '', validate: richTextMaxLength(3000) },
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
  }],
}, { timestamps: true, optimisticConcurrency: true });

schema.index({ status: 1, createdAt: -1 });
schema.index({ petId: 1, createdAt: -1 });
export default mongoose.model('MedicationOrder', schema);
