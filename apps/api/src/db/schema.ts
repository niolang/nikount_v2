import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { ACTOR_KINDS, NIKOUNT_STATES } from '@nikount/contracts';

/**
 * Schéma PostgreSQL — voir docs/data-model.md.
 * Les tables sont ajoutées phase par phase ; tout changement passe par une migration versionnée.
 */

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
});

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const nikountState = pgEnum('nikount_state', NIKOUNT_STATES);
export const actorKind = pgEnum('actor_kind', ACTOR_KINDS);

export const nikount = pgTable(
  'nikount',
  {
    /** UUID v7 généré par l'application. N'est JAMAIS une autorisation. */
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('EUR'),
    timezone: text('timezone').notNull().default('Europe/Paris'),
    state: nikountState('state').notNull().default('OPEN'),
    stateChangedAt: timestamp('state_changed_at', { withTimezone: true }).notNull().defaultNow(),
    /** sha256 du token participant : sert à la recherche. */
    participantTokenHash: bytea('participant_token_hash').notNull().unique(),
    /**
     * Token participant chiffré (AES-256-GCM, clé hors base) : permet aux admins de réafficher
     * le lien à partager. Un dump de la base seule ne donne aucun accès (décision D17).
     */
    participantTokenCiphertext: bytea('participant_token_ciphertext').notNull(),
    participantTokenRotatedAt: timestamp('participant_token_rotated_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt,
    updatedAt,
  },
  (t) => [
    check('nikount_name_length', sql`char_length(${t.name}) between 1 and 60`),
    check('nikount_currency_format', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('nikount_token_hash_length', sql`octet_length(${t.participantTokenHash}) = 32`),
    check('nikount_version_positive', sql`${t.version} >= 1`),
  ],
);

/** Un lien admin = une ligne : plusieurs admins, révocation individuelle, actions nominatives. */
export const adminAccess = pgTable(
  'admin_access',
  {
    id: uuid('id').primaryKey(),
    nikountId: uuid('nikount_id')
      .notNull()
      .references(() => nikount.id),
    label: text('label').notNull(),
    tokenHash: bytea('token_hash').notNull().unique(),
    /** NULL pour le créateur du nikount. */
    createdByAdminId: uuid('created_by_admin_id'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [
    index('admin_access_nikount_idx').on(t.nikountId),
    check('admin_access_label_length', sql`char_length(${t.label}) between 1 and 40`),
    check('admin_access_token_hash_length', sql`octet_length(${t.tokenHash}) = 32`),
  ],
);

/** Journal d'audit append-only (UPDATE et DELETE interdits par trigger, migration 0002). */
export const auditEvent = pgTable(
  'audit_event',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    nikountId: uuid('nikount_id')
      .notNull()
      .references(() => nikount.id),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorKind: actorKind('actor_kind').notNull(),
    actorAdminId: uuid('actor_admin_id').references(() => adminAccess.id),
    /** Identité déclarée (non vérifiée) d'un participant. */
    actorParticipantId: uuid('actor_participant_id'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    requestId: text('request_id'),
  },
  (t) => [
    index('audit_event_nikount_occurred_idx').on(t.nikountId, t.occurredAt.desc()),
    check(
      'audit_event_actor_consistency',
      sql`(${t.actorKind} = 'ADMIN') = (${t.actorAdminId} is not null)`,
    ),
  ],
);
