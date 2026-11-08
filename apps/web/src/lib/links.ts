import type { AccessRole } from '@nikount/contracts';

/** Chemin de l'application pour un token : `/n/…` (participant) ou `/a/…` (admin). */
export function nikountPath(role: AccessRole, token: string): string {
  return `${role === 'ADMIN' ? '/a' : '/n'}/${token}`;
}

/** Lien complet à partager (même origine que l'application). */
export function nikountUrl(role: AccessRole, token: string): string {
  return `${window.location.origin}${nikountPath(role, token)}`;
}
