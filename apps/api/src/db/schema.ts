import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  date,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ACTOR_KINDS,
  DISTRIBUTION_MODES,
  NIKOUNT_STATES,
  TRANSACTION_CATEGORIES,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
} from '@nikount/contracts';

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

/**
 * Participant d'un nikount. Jamais supprimé (il peut figurer dans des opérations) : désactivé.
 * UNIQUE (nikount_id, id) sert de cible aux clés étrangères composites, qui empêchent en base
 * qu'une ligne d'un nikount référence un participant d'un autre nikount (anti-IDOR).
 */
export const participant = pgTable(
  'participant',
  {
    id: uuid('id').primaryKey(),
    nikountId: uuid('nikount_id')
      .notNull()
      .references(() => nikount.id),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull(),
    version: integer('version').notNull().default(1),
    createdAt,
    updatedAt,
  },
  (t) => [
    unique('participant_nikount_id_id_unique').on(t.nikountId, t.id),
    // Deux participants ACTIFS d'un même nikount ne peuvent pas porter le même nom (casse ignorée).
    uniqueIndex('participant_active_name_unique')
      .on(t.nikountId, sql`lower(${t.name})`)
      .where(sql`${t.isActive}`),
    check('participant_name_length', sql`char_length(${t.name}) between 1 and 40`),
    check('participant_sort_order_positive', sql`${t.sortOrder} >= 0`),
    check('participant_version_positive', sql`${t.version} >= 1`),
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
    /** Participant que représente cet admin (NULL : admin non participant, ex. trésorier). */
    participantId: uuid('participant_id'),
    tokenHash: bytea('token_hash').notNull().unique(),
    /** NULL pour le créateur du nikount. */
    createdByAdminId: uuid('created_by_admin_id'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [
    index('admin_access_nikount_idx').on(t.nikountId),
    unique('admin_access_nikount_id_id_unique').on(t.nikountId, t.id),
    foreignKey({
      name: 'admin_access_participant_same_nikount_fk',
      columns: [t.nikountId, t.participantId],
      foreignColumns: [participant.nikountId, participant.id],
    }),
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

// --- Opérations financières (docs/data-model.md) ------------------------------------------

export const transactionType = pgEnum('transaction_type', TRANSACTION_TYPES);
export const transactionStatus = pgEnum('transaction_status', TRANSACTION_STATUSES);
export const distributionMode = pgEnum('distribution_mode', DISTRIBUTION_MODES);
export const transactionCategory = pgEnum('transaction_category', TRANSACTION_CATEGORIES);

/**
 * Opération financière : dépense ou remboursement, même entité (docs/product.md §5).
 * Jamais supprimée (trigger, migration 0005) : annulée. Toutes les références vers des
 * participants ou des admins passent par des clés composites limitées au même nikount.
 */
export const financialTransaction = pgTable(
  'transaction',
  {
    id: uuid('id').primaryKey(),
    nikountId: uuid('nikount_id')
      .notNull()
      .references(() => nikount.id),
    type: transactionType('type').notNull(),
    status: transactionStatus('status').notNull(),
    /** Unités mineures (centimes). */
    amount: bigint('amount', { mode: 'number' }).notNull(),
    description: text('description').notNull(),
    category: transactionCategory('category'),
    occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
    payerId: uuid('payer_id').notNull(),
    distributionMode: distributionMode('distribution_mode').notNull(),
    createdByKind: actorKind('created_by_kind').notNull(),
    createdByAdminId: uuid('created_by_admin_id'),
    /** Identité déclarée (non vérifiée) de l'auteur participant. */
    declaredByParticipantId: uuid('declared_by_participant_id'),
    /** Idempotence : une même saisie renvoyée deux fois ne crée qu'une opération. */
    clientRequestId: uuid('client_request_id').notNull(),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    validatedByAdminId: uuid('validated_by_admin_id'),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectedByAdminId: uuid('rejected_by_admin_id'),
    rejectionReason: text('rejection_reason'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledByAdminId: uuid('cancelled_by_admin_id'),
    cancellationReason: text('cancellation_reason'),
    version: integer('version').notNull().default(1),
    createdAt,
    updatedAt,
  },
  (t) => [
    unique('transaction_nikount_id_id_unique').on(t.nikountId, t.id),
    unique('transaction_client_request_unique').on(t.nikountId, t.clientRequestId),
    index('transaction_nikount_status_idx').on(t.nikountId, t.status),
    index('transaction_nikount_occurred_idx').on(
      t.nikountId,
      t.occurredOn.desc(),
      t.createdAt.desc(),
    ),
    foreignKey({
      name: 'transaction_payer_same_nikount_fk',
      columns: [t.nikountId, t.payerId],
      foreignColumns: [participant.nikountId, participant.id],
    }),
    foreignKey({
      name: 'transaction_declared_by_same_nikount_fk',
      columns: [t.nikountId, t.declaredByParticipantId],
      foreignColumns: [participant.nikountId, participant.id],
    }),
    foreignKey({
      name: 'transaction_created_by_same_nikount_fk',
      columns: [t.nikountId, t.createdByAdminId],
      foreignColumns: [adminAccess.nikountId, adminAccess.id],
    }),
    foreignKey({
      name: 'transaction_validated_by_same_nikount_fk',
      columns: [t.nikountId, t.validatedByAdminId],
      foreignColumns: [adminAccess.nikountId, adminAccess.id],
    }),
    foreignKey({
      name: 'transaction_rejected_by_same_nikount_fk',
      columns: [t.nikountId, t.rejectedByAdminId],
      foreignColumns: [adminAccess.nikountId, adminAccess.id],
    }),
    foreignKey({
      name: 'transaction_cancelled_by_same_nikount_fk',
      columns: [t.nikountId, t.cancelledByAdminId],
      foreignColumns: [adminAccess.nikountId, adminAccess.id],
    }),
    check('transaction_amount_range', sql`${t.amount} > 0 and ${t.amount} <= 100000000`),
    check('transaction_description_length', sql`char_length(${t.description}) between 1 and 80`),
    check('transaction_version_positive', sql`${t.version} >= 1`),
    check(
      'transaction_reimbursement_equal',
      sql`${t.type} <> 'REIMBURSEMENT' or ${t.distributionMode} = 'EQUAL'`,
    ),
    check(
      'transaction_creator_consistency',
      sql`${t.createdByKind} <> 'SYSTEM' and (${t.createdByKind} = 'ADMIN') = (${t.createdByAdminId} is not null)`,
    ),
    // Chaque statut porte ses traces (qui, quand) : un statut sans trace est impossible.
    check(
      'transaction_status_consistency',
      sql`case ${t.status}
        when 'PENDING' then ${t.validatedAt} is null and ${t.rejectedAt} is null and ${t.cancelledAt} is null
        when 'VALIDATED' then ${t.validatedAt} is not null and ${t.validatedByAdminId} is not null
          and ${t.rejectedAt} is null and ${t.cancelledAt} is null
        when 'REJECTED' then ${t.rejectedAt} is not null and ${t.rejectedByAdminId} is not null
          and ${t.validatedAt} is null and ${t.cancelledAt} is null
        when 'CANCELLED' then ${t.cancelledAt} is not null and ${t.cancelledByAdminId} is not null
          and ${t.rejectedAt} is null
      end`,
    ),
  ],
);

/** Une ligne par concerné : valeur saisie et montant final figé (docs/data-model.md). */
export const transactionShare = pgTable(
  'transaction_share',
  {
    id: uuid('id').primaryKey(),
    transactionId: uuid('transaction_id').notNull(),
    nikountId: uuid('nikount_id').notNull(),
    participantId: uuid('participant_id').notNull(),
    inputValue: numeric('input_value', { precision: 12, scale: 2, mode: 'number' }).notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
  },
  (t) => [
    unique('transaction_share_participant_unique').on(t.transactionId, t.participantId),
    index('transaction_share_nikount_participant_idx').on(t.nikountId, t.participantId),
    foreignKey({
      name: 'transaction_share_transaction_same_nikount_fk',
      columns: [t.nikountId, t.transactionId],
      foreignColumns: [financialTransaction.nikountId, financialTransaction.id],
    }),
    foreignKey({
      name: 'transaction_share_participant_same_nikount_fk',
      columns: [t.nikountId, t.participantId],
      foreignColumns: [participant.nikountId, participant.id],
    }),
    check('transaction_share_amount_positive', sql`${t.amount} >= 0`),
    check('transaction_share_input_positive', sql`${t.inputValue} >= 0`),
  ],
);

/** Instantané complet de l'opération à chaque création et modification (append-only). */
export const transactionRevision = pgTable(
  'transaction_revision',
  {
    id: uuid('id').primaryKey(),
    transactionId: uuid('transaction_id').notNull(),
    nikountId: uuid('nikount_id').notNull(),
    revision: integer('revision').notNull(),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    changedByKind: actorKind('changed_by_kind').notNull(),
    changedByAdminId: uuid('changed_by_admin_id'),
    declaredByParticipantId: uuid('declared_by_participant_id'),
    reason: text('reason'),
    createdAt,
  },
  (t) => [
    unique('transaction_revision_number_unique').on(t.transactionId, t.revision),
    foreignKey({
      name: 'transaction_revision_transaction_same_nikount_fk',
      columns: [t.nikountId, t.transactionId],
      foreignColumns: [financialTransaction.nikountId, financialTransaction.id],
    }),
    foreignKey({
      name: 'transaction_revision_admin_same_nikount_fk',
      columns: [t.nikountId, t.changedByAdminId],
      foreignColumns: [adminAccess.nikountId, adminAccess.id],
    }),
    check('transaction_revision_number_positive', sql`${t.revision} >= 1`),
  ],
);
