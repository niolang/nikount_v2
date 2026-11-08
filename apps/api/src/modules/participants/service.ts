import type { z } from 'zod';
import {
  MAX_PARTICIPANTS,
  participantNameKey,
  type ParticipantView,
  type UpdateParticipantRequest,
} from '@nikount/contracts';
import { isActionAllowed } from '@nikount/core';
import type { AdminAccessContext } from '../../auth/access.js';
import type { Database } from '../../db/client.js';
import { isUniqueViolation } from '../../lib/db-errors.js';
import { DomainError } from '../../lib/errors.js';
import { uuidv7 } from '../../lib/uuid.js';
import { recordAuditEvent } from '../audit/repository.js';
import { getNikount } from '../nikounts/service.js';
import * as repo from './repository.js';

export type UpdateParticipantInput = z.output<typeof UpdateParticipantRequest>;

interface RequestMeta {
  requestId: string;
}

const ACTIVE_NAME_INDEX = 'participant_active_name_unique';

export function toParticipantView(row: repo.ParticipantRow): ParticipantView {
  return {
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    version: row.version,
  };
}

const nameTaken = (name: string | undefined) =>
  name === undefined
    ? new DomainError(409, 'PARTICIPANT_NAME_TAKEN', 'Un participant actif porte déjà ce nom.')
    : new DomainError(409, 'PARTICIPANT_NAME_TAKEN', `Un participant s’appelle déjà « ${name} ».`, {
        name,
      });

/** Traduit la violation de l'index d'unicité (cas de concurrence) en erreur métier lisible. */
async function guardUniqueName<T>(
  name: string | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isUniqueViolation(error, ACTIVE_NAME_INDEX)) throw nameTaken(name);
    throw error;
  }
}

async function assertCanManageParticipants(db: Database, nikountId: string): Promise<void> {
  const nikount = await getNikount(db, nikountId);
  if (!isActionAllowed('MANAGE_PARTICIPANTS', nikount.state)) {
    throw new DomainError(409, 'INVALID_STATE', 'Ce nikount est clôturé : participants figés.');
  }
}

async function assertNameAvailable(
  db: Database,
  nikountId: string,
  name: string,
  exceptId?: string,
): Promise<void> {
  const key = participantNameKey(name);
  const clash = (await repo.listParticipants(db, nikountId)).find(
    (p) => p.isActive && p.id !== exceptId && participantNameKey(p.name) === key,
  );
  if (clash) throw nameTaken(clash.name);
}

export async function listParticipants(db: Database, nikountId: string) {
  return (await repo.listParticipants(db, nikountId)).map(toParticipantView);
}

export async function createParticipant(
  db: Database,
  access: AdminAccessContext,
  name: string,
  meta: RequestMeta,
): Promise<ParticipantView> {
  return guardUniqueName(name, () =>
    db.transaction(async (tx) => {
      await assertCanManageParticipants(tx, access.nikountId);
      if ((await repo.countParticipants(tx, access.nikountId)) >= MAX_PARTICIPANTS) {
        throw new DomainError(
          409,
          'PARTICIPANT_LIMIT_REACHED',
          `Un nikount compte au plus ${String(MAX_PARTICIPANTS)} participants.`,
        );
      }
      await assertNameAvailable(tx, access.nikountId, name);

      const [row] = await repo.insertParticipants(tx, [
        {
          id: uuidv7(),
          nikountId: access.nikountId,
          name,
          sortOrder: await repo.nextSortOrder(tx, access.nikountId),
        },
      ]);
      if (!row) throw new Error('Insertion du participant sans retour');

      await recordAuditEvent(tx, {
        nikountId: access.nikountId,
        actorKind: 'ADMIN',
        actorAdminId: access.adminId,
        action: 'participant.created',
        entityType: 'participant',
        entityId: row.id,
        data: { name },
        requestId: meta.requestId,
      });
      return toParticipantView(row);
    }),
  );
}

export async function updateParticipant(
  db: Database,
  access: AdminAccessContext,
  participantId: string,
  input: UpdateParticipantInput,
  meta: RequestMeta,
): Promise<ParticipantView> {
  const { version, ...changes } = input;

  return guardUniqueName(changes.name, () =>
    db.transaction(async (tx) => {
      await assertCanManageParticipants(tx, access.nikountId);
      const current = await repo.findParticipant(tx, access.nikountId, participantId);
      // Introuvable dans CE nikount : même réponse qu'un identifiant inexistant (pas de fuite).
      if (!current) throw new DomainError(404, 'NOT_FOUND', 'Ressource introuvable.');
      if (current.version !== version) {
        throw new DomainError(
          409,
          'VERSION_CONFLICT',
          'Ce participant a été modifié entre-temps.',
          {
            currentVersion: current.version,
          },
        );
      }

      const becomesActive = changes.isActive ?? current.isActive;
      const finalName = changes.name ?? current.name;
      if (becomesActive) await assertNameAvailable(tx, access.nikountId, finalName, current.id);

      const updated = await repo.updateParticipant(
        tx,
        access.nikountId,
        participantId,
        version,
        Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)),
      );
      if (!updated) {
        throw new DomainError(409, 'VERSION_CONFLICT', 'Ce participant a été modifié entre-temps.');
      }

      const diff: Record<string, { from: unknown; to: unknown }> = {};
      for (const key of ['name', 'isActive', 'sortOrder'] as const) {
        if (current[key] !== updated[key]) diff[key] = { from: current[key], to: updated[key] };
      }
      await recordAuditEvent(tx, {
        nikountId: access.nikountId,
        actorKind: 'ADMIN',
        actorAdminId: access.adminId,
        action: 'participant.updated',
        entityType: 'participant',
        entityId: updated.id,
        data: diff,
        requestId: meta.requestId,
      });
      return toParticipantView(updated);
    }),
  );
}
