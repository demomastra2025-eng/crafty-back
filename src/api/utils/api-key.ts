import crypto from 'crypto';

const KEY_PREFIX = 'ck_';

export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `${KEY_PREFIX}${crypto.randomBytes(24).toString('base64url')}`;
  const hash = hashApiKey(raw);
  const prefix = raw.slice(0, 8);
  return { raw, hash, prefix };
}

export function hashApiKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
