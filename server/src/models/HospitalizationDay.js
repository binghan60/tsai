import mongoose from 'mongoose';

// 住院每天一筆：當天的體重。日期是診所時區的 YYYY-MM-DD。
// 體重算進貓咪的最近體重（lib/latestWeight.js）。
const hospitalizationDaySchema = new mongoose.Schema(
  {
    hospitalizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospitalization', required: true },
    petId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pet', required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    weightKg: { type: Number, min: 0, default: null },
  },
  { timestamps: true }
);

hospitalizationDaySchema.index({ hospitalizationId: 1, date: 1 }, { unique: true });
// 最近體重：這隻貓日期最新、有體重的那一天。
hospitalizationDaySchema.index({ petId: 1, date: -1 });

export default mongoose.model('HospitalizationDay', hospitalizationDaySchema);
