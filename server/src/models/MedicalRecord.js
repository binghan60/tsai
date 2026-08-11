import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

const medicalRecordSchema = new mongoose.Schema(
  {
    petId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pet', required: true },
    vet: { type: String, required: true, trim: true },
    visitDate: { type: Date, required: true },

    // 病人陳述
    chiefComplaint: { type: String, default: '' },
    history: { type: String, default: '' },

    // 醫生判斷
    diagnosis: { type: String, default: '' },
    treatmentPlan: { type: String, default: '' },
    conclusion: { type: String, default: '' },
    other: { type: String, default: '' },

    shareToken: { type: String, default: uuidv4, unique: true },
    status: {
      type: String,
      enum: ['draft', 'generated', 'sent'],
      default: 'draft',
    },
    sentAt: { type: Date },
  },
  { timestamps: true }
);

medicalRecordSchema.index({ petId: 1 });

export default mongoose.model('MedicalRecord', medicalRecordSchema);
