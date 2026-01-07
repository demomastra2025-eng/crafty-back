import crypto from 'crypto';
import { Auth, configService } from '@config/env.config';

const IV_BYTES = 12;

function getKey(): Buffer {
  const secret = configService.get<Auth>('AUTHENTICATION').KEY_ENCRYPTION_SECRET;
  if (!secret || secret === 'change-me' || secret === 'change-me-too') {
    throw new Error('AUTH_KEY_ENCRYPTION_SECRET must be set');
  }
  return crypto.scryptSync(secret, 'evo-key-salt', 32);
}

export function encryptApiKey(raw: string): { encryptedKey: string; keyIv: string } {
  const iv = crypto.randomBytes(IV_BYTES);
  const key = getKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([ciphertext, tag]).toString('base64');
  return { encryptedKey: payload, keyIv: iv.toString('base64') };
}

export function decryptApiKey(encryptedKey: string, keyIv: string): string {
  const key = getKey();
  const iv = Buffer.from(keyIv, 'base64');
  const data = Buffer.from(encryptedKey, 'base64');
  const tag = data.subarray(data.length - 16);
  const ciphertext = data.subarray(0, data.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
