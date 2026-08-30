import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/models/User.js';

const [username] = process.argv.slice(2);
if (!username) {
  console.error('Usage: node scripts/revoke-sessions.js <username>');
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI);
const user = await User.findOneAndUpdate({ username }, { $inc: { tokenVersion: 1 } }, { new: true });
if (!user) {
  console.error(`找不到帳號「${username}」`);
  await mongoose.disconnect();
  process.exit(1);
}
console.log(`[auth] 已撤銷帳號「${user.username}」目前所有登入 session`);
await mongoose.disconnect();
process.exit(0);
