import crypto from 'crypto';

const SALT_BYTES = 16;
const KEY_BYTES = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  const derived = crypto.scryptSync(password, salt, KEY_BYTES) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, KEY_BYTES) as Buffer;
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== derived.length) return false;
  return crypto.timingSafeEqual(expected, derived);
}
