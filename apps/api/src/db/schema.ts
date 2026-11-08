import { sql } from 'drizzle-orm';
import {
  char,
  check,
  customType,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { NIKOUNT_STATES } from '@nikount/contracts';

/**
 * Schéma PostgreSQL — voir docs/data-model.md.
 * Les tables sont ajoutées phase par phase ; tout changement passe par une migration versionnée.
 */

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
});

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const nikountState = pgEnum('nikount_state', NIKOUNT_STATES);

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
    /** sha256 du token participant. Le token en clair n'est jamais stocké. */
    participantTokenHash: bytea('participant_token_hash').notNull().unique(),
    participantTokenRotatedAt: timestamp('participant_token_rotated_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (t) => [
    check('nikount_name_length', sql`char_length(${t.name}) between 1 and 60`),
    check('nikount_currency_format', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('nikount_token_hash_length', sql`octet_length(${t.participantTokenHash}) = 32`),
    check('nikount_version_positive', sql`${t.version} >= 1`),
  ],
);
