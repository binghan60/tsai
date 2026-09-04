import mongoose from 'mongoose';

function createMedicalRecordNumber() {
  const suffix = this?._id?.toString().slice(-8).toUpperCase();
  return `PET-${suffix || new mongoose.Types.ObjectId().toString().slice(-8).toUpperCase()}`;
}

const petSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', required: true },
    medicalRecordNumber: { type: String, default: createMedicalRecordNumber, trim: true },
    legacyMedicalRecordNumber: { type: String, trim: true, default: null },
    species: { type: String, default: '貓', trim: true },
    breed: { type: String, default: '', trim: true },
    sex: { type: String, enum: ['unknown', 'male', 'female'], default: 'unknown' },
    neutered: { type: String, enum: ['unknown', 'yes', 'no'], default: 'unknown' },
    birthDate: { type: Date, default: null },
    birthDateEstimated: { type: Boolean, default: false },
    weightKg: { type: Number, min: 0, default: null },
    allergies: { type: String, default: '', trim: true },
    chronicConditions: { type: String, default: '', trim: true },
    currentMedications: { type: String, default: '', trim: true },
    notes: { type: String, default: '', trim: true },
    relationVersion: { type: Number, default: 0, select: false },
  },
  { timestamps: true, optimisticConcurrency: true }
);

petSchema.index({ ownerId: 1, createdAt: -1, _id: -1 });
petSchema.index({ medicalRecordNumber: 1 }, { unique: true, sparse: true });
petSchema.index({ legacyMedicalRecordNumber: 1 }, { unique: true, sparse: true });
petSchema.index({ updatedAt: -1, _id: -1 });

export default mongoose.model('Pet', petSchema);
