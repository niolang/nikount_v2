import { createHash, randomBytes } from 'node:crypto';
import {
  ADMIN_TOKEN_PREFIX,
  PARTICIPANT_TOKEN_PREFIX,
  tokenRole,
  type AccessRole,
} from '@nikount/contracts';

/** Taille aléatoire de chaque type de token, en octets (docs/security.md §2). */
const TOKEN_BYTES: Record<AccessRole, number> = { PARTICIPANT: 16, ADMIN: 32 };
const TOKEN_PREFIX: Record<AccessRole, string> = {
  PARTICIPANT: PARTICIPANT_TOKEN_PREFIX,
  ADMIN: ADMIN_TOKEN_PREFIX,
};

/** Génère un token d'accès avec un générateur cryptographiquement sûr. */
export function generateToken(role: AccessRole): string {
  return `${TOKEN_PREFIX[role]}${randomBytes(TOKEN_BYTES[role]).toString('base64url')}`;
}

/** Empreinte stockée en base. Le token en clair n'est jamais persisté. */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export interface PresentedToken {
  role: AccessRole;
  token: string;
}

/** Extrait un token bien formé de l'en-tête `Authorization: Bearer …`, sinon `null`. */
export function parseBearerToken(header: string | undefined): PresentedToken | null {
  if (!header) return null;
  const match = /^Bearer ([^\s]+)$/.exec(header);
  const token = match?.[1];
  if (!token) return null;
  const role = tokenRole(token);
  return role ? { role, token } : null;
}
