import mongoose from 'mongoose';

const quickMenuItemSchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true, maxlength: 80 },
  content: { type: String, required: true, trim: true, maxlength: 1000 },
  enabled: { type: Boolean, default: true },
}, { _id: true });

const quickMenuSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80, unique: true },
  enabled: { type: Boolean, default: true },
  items: { type: [quickMenuItemSchema], default: [] },
}, { timestamps: true, optimisticConcurrency: true });

quickMenuSchema.index({ enabled: 1, name: 1 });
export default mongoose.model('QuickMenu', quickMenuSchema);
