import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Chiffrement authentifié (AES-256-GCM) de petits secrets stockés en base, avec une clé
 * qui n'est jamais en base (variable d'environnement TOKEN_ENCRYPTION_KEY).
 * `context` (ex. l'id du nikount) est lié au chiffré : impossible de le recopier sur une autre ligne.
 * Format stocké : iv (12) ‖ tag (16) ‖ chiffré.
 */
export class SecretBox {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('La clé de chiffrement doit faire 32 octets');
  }

  seal(plaintext: string, context: string): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  open(sealed: Uint8Array, context: string): string {
    const data = Buffer.from(sealed);
    const iv = data.subarray(0, IV_BYTES);
    const tag = data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = data.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
