import mongoose from 'mongoose';

const ownerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true },
    // 子資料建立時會遞增，讓「新增寵物」與「刪除飼主」在 transaction 中產生寫入衝突。
    relationVersion: { type: Number, default: 0, select: false },
  },
  { timestamps: true }
);

ownerSchema.index({ name: 1 });
ownerSchema.index({ phone: 1 });

export default mongoose.model('Owner', ownerSchema);
