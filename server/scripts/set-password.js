import 'dotenv/config';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import User from '../src/models/User.js';

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error('Usage: node scripts/set-password.js <username> <new-password>');
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString('base64url');
const hash = crypto.scryptSync(password, Buffer.from(salt, 'base64url'), 64).toString('base64url');
const passwordHash = `scrypt$${salt}$${hash}`;

await mongoose.connect(process.env.MONGODB_URI);
// $inc tokenVersion 讓這個帳號目前所有已登入的瀏覽器立即失效，不用等 30 天 JWT 自然過期。
const user = await User.findOneAndUpdate(
  { username },
  { $set: { passwordHash, active: true }, $inc: { tokenVersion: 1 } },
  { upsert: true, new: true, setDefaultsOnInsert: true },
);
console.log(`[auth] 已設定帳號「${user.username}」的密碼，所有既有登入 session 已同時失效`);
await mongoose.disconnect();
process.exit(0);
