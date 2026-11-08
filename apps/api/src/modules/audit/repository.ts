import type { ActorKind } from '@nikount/contracts';
import type { Database } from '../../db/client.js';
import { auditEvent } from '../../db/schema.js';

export interface AuditEntry {
  nikountId: string;
  actorKind: ActorKind;
  actorAdminId?: string | null;
  actorParticipantId?: string | null;
  /** Format `entité.verbe_au_passé`, ex. `nikount.created`. */
  action: string;
  entityType?: string;
  entityId?: string;
  data?: Record<string, unknown>;
  requestId?: string;
}

/**
 * Écrit un événement d'audit. À appeler dans la MÊME transaction que l'action auditée :
 * soit les deux sont enregistrés, soit aucun.
 */
export async function recordAuditEvent(db: Database, entry: AuditEntry): Promise<void> {
  await db.insert(auditEvent).values({
    nikountId: entry.nikountId,
    actorKind: entry.actorKind,
    actorAdminId: entry.actorAdminId ?? null,
    actorParticipantId: entry.actorParticipantId ?? null,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    data: entry.data ?? {},
    requestId: entry.requestId ?? null,
  });
}
