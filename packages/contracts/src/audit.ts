import { z } from 'zod';
import { ActorKind } from './enums.js';

/** Événements par page du journal d'audit. */
export const AUDIT_PAGE_SIZE = 50;

/**
 * Filtres du journal (admin). `action` accepte une action exacte (`transaction.validated`) ou une
 * famille (`transaction`) ; `before` est le curseur renvoyé par la page précédente.
 */
export const AuditQuery = z.strictObject({
  action: z
    .string()
    .regex(/^[a-z_]+(\.[a-z_]+)?$/)
    .max(60)
    .optional(),
  entityId: z.uuid().optional(),
  before: z.coerce.number().int().min(1).optional(),
});
export type AuditQuery = z.input<typeof AuditQuery>;

export const AuditEventView = z.object({
  id: z.number().int(),
  occurredAt: z.iso.datetime({ offset: true }),
  actor: z.object({
    kind: ActorKind,
    admin: z.object({ id: z.uuid(), label: z.string() }).nullable(),
    /** Identité déclarée (non vérifiée) d'un participant, ou participant lié à l'admin. */
    participantId: z.uuid().nullable(),
  }),
  action: z.string(),
  entityType: z.string().nullable(),
  entityId: z.uuid().nullable(),
  data: z.record(z.string(), z.unknown()),
});
export type AuditEventView = z.infer<typeof AuditEventView>;

export const AuditListResponse = z.object({
  events: z.array(AuditEventView),
  /** Curseur pour la page suivante (plus ancienne), `null` s'il n'y en a plus. */
  nextBefore: z.number().int().nullable(),
});
export type AuditListResponse = z.infer<typeof AuditListResponse>;
