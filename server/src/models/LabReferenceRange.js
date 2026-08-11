import mongoose from 'mongoose';

const labReferenceRangeSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    species: { type: String, enum: ['cat', 'dog', 'all'], required: true },
    unit: { type: String, default: '', trim: true },
    min: { type: Number, default: null },
    max: { type: Number, default: null },
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

labReferenceRangeSchema.index({ key: 1, species: 1 }, { unique: true });

export default mongoose.model('LabReferenceRange', labReferenceRangeSchema);
