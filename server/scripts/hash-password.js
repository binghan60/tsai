import crypto from 'node:crypto';

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-password.js <password>');
  process.exit(1);
}
const salt = crypto.randomBytes(16).toString('base64url');
const hash = crypto.scryptSync(password, Buffer.from(salt, 'base64url'), 64).toString('base64url');
console.log(`scrypt$${salt}$${hash}`);
