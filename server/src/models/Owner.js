import mongoose from 'mongoose';

const ownerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true },
  },
  { timestamps: true }
);

ownerSchema.index({ name: 1 });
ownerSchema.index({ phone: 1 });

export default mongoose.model('Owner', ownerSchema);
