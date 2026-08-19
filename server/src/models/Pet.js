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
    species: { type: String, default: '貓', trim: true },
    breed: { type: String, default: '', trim: true },
    sex: { type: String, enum: ['unknown', 'male', 'female'], default: 'unknown' },
    neutered: { type: String, enum: ['unknown', 'yes', 'no'], default: 'unknown' },
    birthDate: { type: Date, default: null },
    weightKg: { type: Number, min: 0, default: null },
    allergies: { type: String, default: '', trim: true },
    chronicConditions: { type: String, default: '', trim: true },
    currentMedications: { type: String, default: '', trim: true },
    notes: { type: String, default: '', trim: true },
  },
  { timestamps: true }
);

petSchema.index({ ownerId: 1 });
petSchema.index({ medicalRecordNumber: 1 }, { unique: true, sparse: true });

export default mongoose.model('Pet', petSchema);
