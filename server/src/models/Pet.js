import mongoose from 'mongoose';

const petSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', required: true },
  },
  { timestamps: true }
);

petSchema.index({ ownerId: 1 });

export default mongoose.model('Pet', petSchema);
