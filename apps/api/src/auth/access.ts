import type { FastifyRequest } from 'fastify';
import type { AccessRole } from '@nikount/contracts';
import type { Database } from '../db/client.js';
import { DomainError } from '../lib/errors.js';
import type { FailureLimiter } from '../lib/failure-limiter.js';
import { hashToken, parseBearerToken, type PresentedToken } from '../lib/tokens.js';
import {
  findActiveAdminByTokenHash,
  findNikountIdByParticipantTokenHash,
  touchAdminAccess,
} from '../modules/nikounts/repository.js';

/**
 * Contexte d'accès déduit du token, et UNIQUEMENT du token.
 * Les services n'utilisent que `nikountId` d'ici : un identifiant envoyé par le client n'est
 * jamais une autorisation (docs/security.md §3).
 */
export interface AccessContext {
  nikountId: string;
  role: AccessRole;
  /** Renseigné uniquement pour un accès admin. */
  adminId: string | null;
}

export interface AdminAccessContext extends AccessContext {
  role: 'ADMIN';
  adminId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    access: AccessContext | null;
  }
}

/**
 * Résout un token présenté. Un token participant ne peut JAMAIS résoudre vers un rôle admin :
 * chaque type est cherché dans sa propre table.
 */
export async function resolveAccess(
  db: Database,
  presented: PresentedToken,
): Promise<AccessContext | null> {
  const tokenHash = hashToken(presented.token);

  if (presented.role === 'PARTICIPANT') {
    const nikountId = await findNikountIdByParticipantTokenHash(db, tokenHash);
    return nikountId ? { nikountId, role: 'PARTICIPANT', adminId: null } : null;
  }

  const admin = await findActiveAdminByTokenHash(db, tokenHash);
  if (!admin) return null;
  await touchAdminAccess(db, admin.id);
  return { nikountId: admin.nikountId, role: 'ADMIN', adminId: admin.id };
}

/** Hook d'authentification des routes protégées : 401 générique, 429 après trop d'échecs. */
export function createAuthenticator(deps: {
  db: Database;
  failureLimiter: FailureLimiter;
}): (request: FastifyRequest) => Promise<void> {
  return async (request) => {
    if (deps.failureLimiter.isBlocked(request.ip)) {
      throw new DomainError(429, 'RATE_LIMITED', 'Trop de tentatives. Réessayez plus tard.');
    }

    const presented = parseBearerToken(request.headers.authorization);
    const access = presented ? await resolveAccess(deps.db, presented) : null;

    if (!access) {
      deps.failureLimiter.recordFailure(request.ip);
      // Même réponse pour un token absent, mal formé, inconnu ou révoqué.
      throw new DomainError(401, 'INVALID_TOKEN', 'Ce lien est invalide ou n’est plus actif.');
    }

    request.access = access;
  };
}

/** Contexte d'accès d'une route protégée (le hook garantit sa présence). */
export function getAccess(request: FastifyRequest): AccessContext {
  if (!request.access) {
    throw new DomainError(401, 'INVALID_TOKEN', 'Ce lien est invalide ou n’est plus actif.');
  }
  return request.access;
}

/** Exige un accès admin : 403 pour un participant. */
export function requireAdmin(request: FastifyRequest): AdminAccessContext {
  const access = getAccess(request);
  if (access.role !== 'ADMIN' || access.adminId === null) {
    throw new DomainError(403, 'ADMIN_REQUIRED', 'Action réservée aux administrateurs.');
  }
  return { ...access, role: 'ADMIN', adminId: access.adminId };
}
