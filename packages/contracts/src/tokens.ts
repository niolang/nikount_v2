import type { AccessRole } from './enums.js';

/*
 * Format des tokens d'accès (docs/security.md §2). Le préfixe n'est pas secret : il permet
 * d'identifier le type de lien sans requête. Lien participant : 128 bits ; lien admin : 256 bits,
 * encodés en base64url.
 */
export const PARTICIPANT_TOKEN_PREFIX = 'p_';
export const ADMIN_TOKEN_PREFIX = 'a_';
export const PARTICIPANT_TOKEN_PATTERN = /^p_[A-Za-z0-9_-]{22}$/;
export const ADMIN_TOKEN_PATTERN = /^a_[A-Za-z0-9_-]{43}$/;

/** Rôle porté par un token bien formé, ou `null` si le format est invalide. */
export function tokenRole(token: string): AccessRole | null {
  if (PARTICIPANT_TOKEN_PATTERN.test(token)) return 'PARTICIPANT';
  if (ADMIN_TOKEN_PATTERN.test(token)) return 'ADMIN';
  return null;
}
