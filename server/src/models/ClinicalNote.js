import mongoose from 'mongoose';

const clinicalNoteSchema = new mongoose.Schema(
  {
    petId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pet', required: true },
    entryDate: { type: Date, required: true, default: Date.now },
    content: { type: String, required: true, trim: true },
    source: { type: String, enum: ['manual', 'legacy_import'], default: 'manual' },
  },
  { timestamps: true }
);

clinicalNoteSchema.index({ petId: 1, entryDate: -1, _id: -1 });

export default mongoose.model('ClinicalNote', clinicalNoteSchema);
