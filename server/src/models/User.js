import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, trim: true, unique: true },
  passwordHash: { type: String, required: true, select: false },
  active: { type: Boolean, default: true },
  // 每次改密碼或執行 revoke-sessions 腳本都會 +1，讓所有既有 JWT 立即失效——
  // 這組 JWT 本身無狀態，撤銷只能靠比對這個版本號。
  tokenVersion: { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.model('User', userSchema);
