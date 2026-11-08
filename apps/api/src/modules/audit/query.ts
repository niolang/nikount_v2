import { and, desc, eq, like, lt, or, type SQL } from 'drizzle-orm';
import { AUDIT_PAGE_SIZE, type AuditEventView } from '@nikount/contracts';
import type { Database } from '../../db/client.js';
import { adminAccess, auditEvent } from '../../db/schema.js';

export interface AuditFilters {
  action?: string | undefined;
  entityId?: string | undefined;
  before?: number | undefined;
}

/**
 * Journal d'audit d'UN nikount, du plus récent au plus ancien, par pages de AUDIT_PAGE_SIZE.
 * Pagination par curseur sur l'identifiant (croissant avec le temps) : stable même si de
 * nouveaux événements arrivent entre deux pages.
 */
export async function listAuditEvents(
  db: Database,
  nikountId: string,
  filters: AuditFilters,
): Promise<{ events: AuditEventView[]; nextBefore: number | null }> {
  const conditions: SQL[] = [eq(auditEvent.nikountId, nikountId)];
  if (filters.action) {
    const family = !filters.action.includes('.');
    const condition = family
      ? or(eq(auditEvent.action, filters.action), like(auditEvent.action, `${filters.action}.%`))
      : eq(auditEvent.action, filters.action);
    if (condition) conditions.push(condition);
  }
  if (filters.entityId) conditions.push(eq(auditEvent.entityId, filters.entityId));
  if (filters.before) conditions.push(lt(auditEvent.id, filters.before));

  const rows = await db
    .select({ event: auditEvent, adminLabel: adminAccess.label })
    .from(auditEvent)
    .leftJoin(adminAccess, eq(adminAccess.id, auditEvent.actorAdminId))
    .where(and(...conditions))
    .orderBy(desc(auditEvent.id))
    .limit(AUDIT_PAGE_SIZE + 1);

  const page = rows.slice(0, AUDIT_PAGE_SIZE);
  const last = page.at(-1);
  return {
    events: page.map(({ event, adminLabel }) => ({
      id: event.id,
      occurredAt: event.occurredAt.toISOString(),
      actor: {
        kind: event.actorKind,
        admin: event.actorAdminId ? { id: event.actorAdminId, label: adminLabel ?? '' } : null,
        participantId: event.actorParticipantId,
      },
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      data: event.data,
    })),
    nextBefore: rows.length > AUDIT_PAGE_SIZE && last ? last.event.id : null,
  };
}
