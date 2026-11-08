import type { z } from 'zod';
import { sql } from 'drizzle-orm';
import {
  MAX_ACTIVE_ADMINS,
  type AdminListItem,
  type AdminView,
  type CreateAdminRequest,
  type CreateNikountRequest,
  type NikountState,
  type NikountView,
} from '@nikount/contracts';
import { isActionAllowed, nikountTransition, type NikountAction } from '@nikount/core';
import type { AdminAccessContext } from '../../auth/access.js';
import { queryRows, type Database } from '../../db/client.js';
import { DomainError } from '../../lib/errors.js';
import type { SecretBox } from '../../lib/secret-box.js';
import { generateToken, hashToken } from '../../lib/tokens.js';
import { uuidv7 } from '../../lib/uuid.js';
import { recordAuditEvent } from '../audit/repository.js';
import { findParticipant, insertParticipants } from '../participants/repository.js';
import * as repo from './repository.js';

/** Données de création après validation et normalisation par le schéma Zod. */
export type CreateNikountInput = z.output<typeof CreateNikountRequest>;

export interface RequestMeta {
  requestId: string;
}

export function toNikountView(row: repo.NikountRow): NikountView {
  return {
    name: row.name,
    currency: row.currency,
    timezone: row.timezone,
    state: row.state,
    stateChangedAt: row.stateChangedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

/**
 * Crée un nikount, son lien participant et le lien admin de son créateur, en une seule
 * transaction avec l'événement d'audit. Les tokens en clair ne sont renvoyés qu'ici.
 */
export async function createNikount(
  db: Database,
  secretBox: SecretBox,
  input: CreateNikountInput,
  meta: RequestMeta,
) {
  const participantToken = generateToken('PARTICIPANT');
  const adminToken = generateToken('ADMIN');
  const nikountId = uuidv7();
  const adminId = uuidv7();

  // Le créateur, s'il participe, est le premier participant (ordre d'affichage 0).
  const names = [...(input.adminIsParticipant ? [input.adminLabel] : []), ...input.participants];
  const participantRows = names.map((name, sortOrder) => ({
    id: uuidv7(),
    nikountId,
    name,
    sortOrder,
  }));
  const adminParticipantId = input.adminIsParticipant ? (participantRows[0]?.id ?? null) : null;

  const { nikountRow, adminRow } = await db.transaction(async (tx) => {
    const nikountRow = await repo.insertNikount(tx, {
      id: nikountId,
      name: input.name,
      currency: input.currency,
      participantTokenHash: hashToken(participantToken),
      participantTokenCiphertext: secretBox.seal(participantToken, nikountId),
    });
    await insertParticipants(tx, participantRows);
    const adminRow = await repo.insertAdminAccess(tx, {
      id: adminId,
      nikountId,
      label: input.adminLabel,
      participantId: adminParticipantId,
      tokenHash: hashToken(adminToken),
    });
    await recordAuditEvent(tx, {
      nikountId,
      actorKind: 'ADMIN',
      actorAdminId: adminId,
      action: 'nikount.created',
      entityType: 'nikount',
      entityId: nikountId,
      data: {
        name: input.name,
        currency: input.currency,
        adminLabel: input.adminLabel,
        participants: names,
      },
      requestId: meta.requestId,
    });
    return { nikountRow, adminRow };
  });

  return {
    nikount: toNikountView(nikountRow),
    admin: toAdminView(adminRow),
    participantToken,
    adminToken,
  };
}

export function toAdminView(row: repo.AdminAccessRow): AdminView {
  return { id: row.id, label: row.label, participantId: row.participantId };
}

export async function getNikount(
  db: Database,
  nikountId: string,
  lock?: repo.NikountLock,
): Promise<repo.NikountRow> {
  const row = await repo.findNikount(db, nikountId, lock);
  // Ne peut arriver que si le nikount a disparu entre l'authentification et la lecture.
  if (!row) throw new DomainError(404, 'NOT_FOUND', 'Ressource introuvable.');
  return row;
}

/** Réaffiche le lien participant à un admin (déchiffrement du token stocké). */
export async function getParticipantToken(
  db: Database,
  secretBox: SecretBox,
  nikountId: string,
): Promise<string> {
  const row = await getNikount(db, nikountId);
  return secretBox.open(row.participantTokenCiphertext, row.id);
}

// --- Cycle de vie et paramètres (Phase 9) ---------------------------------

const STATE_LABELS: Record<NikountState, string> = {
  OPEN: 'en cours',
  SETTLEMENT: 'en règlement',
  CLOSED: 'clôturé',
};

const versionConflict = (currentVersion: number) =>
  new DomainError(409, 'VERSION_CONFLICT', 'Ce nikount a été modifié entre-temps.', {
    currentVersion,
  });

function assertAllowed(action: NikountAction, row: repo.NikountRow): void {
  if (!isActionAllowed(action, row.state)) {
    throw new DomainError(
      409,
      'INVALID_STATE',
      'Action impossible dans l’état actuel du nikount.',
      {
        state: row.state,
      },
    );
  }
}

/** Lit le nikount verrouillé et vérifie la version attendue par le client. */
async function lockForChange(db: Database, nikountId: string, version: number) {
  const current = await getNikount(db, nikountId, 'update');
  if (current.version !== version) throw versionConflict(current.version);
  return current;
}

async function applyUpdate(
  db: Database,
  current: repo.NikountRow,
  changes: Parameters<typeof repo.updateNikount>[3],
): Promise<repo.NikountRow> {
  const row = await repo.updateNikount(db, current.id, current.version, changes);
  // Impossible sous verrou, sauf bug : une erreur explicite plutôt qu'une écriture perdue.
  if (!row) throw versionConflict(current.version);
  return row;
}

async function countPending(db: Database, nikountId: string): Promise<number> {
  const rows = await queryRows<{ n: number }>(
    db,
    sql`select count(*)::int as n from transaction where nikount_id = ${nikountId} and status = 'PENDING'`,
  );
  return rows[0]?.n ?? 0;
}

/**
 * Change l'état du nikount (docs/product.md §4) : terminer, déverrouiller, clôturer, réouvrir.
 * Le verrou `FOR UPDATE` sérialise la clôture avec les créations et validations concurrentes
 * (elles prennent un verrou `FOR SHARE`) : aucune opération en attente ne peut apparaître
 * entre le comptage et la clôture.
 */
export async function changeState(
  db: Database,
  access: AdminAccessContext,
  input: { to: NikountState; reason?: string | undefined; version: number },
  meta: RequestMeta,
): Promise<NikountView> {
  return db.transaction(async (tx) => {
    const current = await lockForChange(tx, access.nikountId, input.version);
    const rule = nikountTransition(current.state, input.to);
    if (!rule) {
      throw new DomainError(
        409,
        'INVALID_STATE_TRANSITION',
        `Un nikount ${STATE_LABELS[current.state]} ne peut pas passer à « ${STATE_LABELS[input.to]} ».`,
        { from: current.state, to: input.to },
      );
    }
    if (rule.reasonRequired && !input.reason) {
      throw new DomainError(400, 'REASON_REQUIRED', 'Indiquez le motif de la réouverture.');
    }
    if (rule.requiresNoPending) {
      const pending = await countPending(tx, access.nikountId);
      if (pending > 0) {
        throw new DomainError(
          409,
          'PENDING_REMAINING',
          `Impossible de clôturer : ${String(pending)} opération${pending > 1 ? 's' : ''} en attente de validation.`,
          { pendingCount: pending },
        );
      }
    }

    const row = await applyUpdate(tx, current, { state: input.to, stateChanged: true });
    await recordAuditEvent(tx, {
      nikountId: access.nikountId,
      actorKind: 'ADMIN',
      actorAdminId: access.adminId,
      action: 'nikount.state_changed',
      entityType: 'nikount',
      entityId: access.nikountId,
      data: {
        transition: rule.transition,
        from: current.state,
        to: input.to,
        reason: input.reason ?? null,
      },
      requestId: meta.requestId,
    });
    return toNikountView(row);
  });
}

export async function renameNikount(
  db: Database,
  access: AdminAccessContext,
  input: { name: string; version: number },
  meta: RequestMeta,
): Promise<NikountView> {
  return db.transaction(async (tx) => {
    const current = await lockForChange(tx, access.nikountId, input.version);
    assertAllowed('RENAME_NIKOUNT', current);
    if (current.name === input.name) return toNikountView(current);

    const row = await applyUpdate(tx, current, { name: input.name });
    await recordAuditEvent(tx, {
      nikountId: access.nikountId,
      actorKind: 'ADMIN',
      actorAdminId: access.adminId,
      action: 'nikount.renamed',
      entityType: 'nikount',
      entityId: access.nikountId,
      data: { from: current.name, to: input.name },
      requestId: meta.requestId,
    });
    return toNikountView(row);
  });
}

/** Nouveau lien participant : l'ancien cesse immédiatement de fonctionner. */
export async function rotateParticipantLink(
  db: Database,
  secretBox: SecretBox,
  access: AdminAccessContext,
  meta: RequestMeta,
): Promise<string> {
  const participantToken = generateToken('PARTICIPANT');
  await db.transaction(async (tx) => {
    const current = await getNikount(tx, access.nikountId, 'update');
    assertAllowed('ROTATE_PARTICIPANT_LINK', current);
    await repo.replaceParticipantToken(tx, access.nikountId, {
      participantTokenHash: hashToken(participantToken),
      participantTokenCiphertext: secretBox.seal(participantToken, access.nikountId),
    });
    await recordAuditEvent(tx, {
      nikountId: access.nikountId,
      actorKind: 'ADMIN',
      actorAdminId: access.adminId,
      action: 'nikount.participant_link_rotated',
      entityType: 'nikount',
      entityId: access.nikountId,
      data: {},
      requestId: meta.requestId,
    });
  });
  return participantToken;
}

// --- Admins -----------------------------------------------------------------

export type CreateAdminInput = z.output<typeof CreateAdminRequest>;

export function toAdminListItem(row: repo.AdminAccessRow, currentAdminId: string): AdminListItem {
  return {
    ...toAdminView(row),
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    isYou: row.id === currentAdminId,
  };
}

export async function listAdmins(db: Database, access: AdminAccessContext) {
  return (await repo.listAdmins(db, access.nikountId)).map((row) =>
    toAdminListItem(row, access.adminId),
  );
}

/** Crée un lien admin supplémentaire ; son token n'est renvoyé qu'une fois (D11). */
export async function createAdmin(
  db: Database,
  access: AdminAccessContext,
  input: CreateAdminInput,
  meta: RequestMeta,
): Promise<{ admin: AdminListItem; adminToken: string }> {
  const adminToken = generateToken('ADMIN');
  const row = await db.transaction(async (tx) => {
    const current = await getNikount(tx, access.nikountId, 'update');
    assertAllowed('MANAGE_ADMINS', current);
    if ((await repo.countActiveAdmins(tx, access.nikountId)) >= MAX_ACTIVE_ADMINS) {
      throw new DomainError(
        409,
        'ADMIN_LIMIT_REACHED',
        `Un nikount compte au plus ${String(MAX_ACTIVE_ADMINS)} administrateurs actifs.`,
      );
    }
    if (input.participantId) {
      const participant = await findParticipant(tx, access.nikountId, input.participantId);
      // Participant d'un autre nikount ou désactivé : même réponse qu'un identifiant inexistant.
      if (!participant?.isActive) {
        throw new DomainError(404, 'NOT_FOUND', 'Participant introuvable.');
      }
    }

    const row = await repo.insertAdminAccess(tx, {
      id: uuidv7(),
      nikountId: access.nikountId,
      label: input.label,
      participantId: input.participantId,
      tokenHash: hashToken(adminToken),
      createdByAdminId: access.adminId,
    });
    await recordAuditEvent(tx, {
      nikountId: access.nikountId,
      actorKind: 'ADMIN',
      actorAdminId: access.adminId,
      action: 'admin.created',
      entityType: 'admin_access',
      entityId: row.id,
      data: { label: input.label, participantId: input.participantId },
      requestId: meta.requestId,
    });
    return row;
  });
  return { admin: toAdminListItem(row, access.adminId), adminToken };
}

/** Révoque un lien admin. Le dernier admin actif ne peut pas l'être (nikount orphelin). */
export async function revokeAdmin(
  db: Database,
  access: AdminAccessContext,
  adminId: string,
  meta: RequestMeta,
): Promise<AdminListItem> {
  return db.transaction(async (tx) => {
    const current = await getNikount(tx, access.nikountId, 'update');
    assertAllowed('MANAGE_ADMINS', current);
    const target = await repo.findAdminAccess(tx, access.nikountId, adminId);
    if (!target) throw new DomainError(404, 'NOT_FOUND', 'Ressource introuvable.');
    if (target.revokedAt) return toAdminListItem(target, access.adminId);
    if ((await repo.countActiveAdmins(tx, access.nikountId)) <= 1) {
      throw new DomainError(
        409,
        'LAST_ADMIN',
        'Impossible de révoquer le dernier administrateur : ajoutez-en un autre avant.',
      );
    }

    const row = await repo.revokeAdmin(tx, access.nikountId, adminId);
    if (!row) throw new Error('Révocation sans retour');
    await recordAuditEvent(tx, {
      nikountId: access.nikountId,
      actorKind: 'ADMIN',
      actorAdminId: access.adminId,
      action: 'admin.revoked',
      entityType: 'admin_access',
      entityId: adminId,
      data: { label: target.label, self: adminId === access.adminId },
      requestId: meta.requestId,
    });
    return toAdminListItem(row, access.adminId);
  });
}
