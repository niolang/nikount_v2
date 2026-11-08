import { z } from 'zod';

/*
 * Valeurs figées (docs/decisions.md). Les tuples `as const` sont réutilisés tels quels
 * par les enums PostgreSQL (apps/api/src/db/schema.ts) : une seule source de vérité.
 */

export const NIKOUNT_STATES = ['OPEN', 'SETTLEMENT', 'CLOSED'] as const;
export const NikountState = z.enum(NIKOUNT_STATES);
export type NikountState = z.infer<typeof NikountState>;

export const TRANSACTION_TYPES = ['EXPENSE', 'REIMBURSEMENT'] as const;
export const TransactionType = z.enum(TRANSACTION_TYPES);
export type TransactionType = z.infer<typeof TransactionType>;

export const TRANSACTION_STATUSES = ['PENDING', 'VALIDATED', 'REJECTED', 'CANCELLED'] as const;
export const TransactionStatus = z.enum(TRANSACTION_STATUSES);
export type TransactionStatus = z.infer<typeof TransactionStatus>;

export const DISTRIBUTION_MODES = ['EQUAL', 'SHARES', 'PERCENT', 'AMOUNT'] as const;
export const DistributionMode = z.enum(DISTRIBUTION_MODES);
export type DistributionMode = z.infer<typeof DistributionMode>;

export const TRANSACTION_CATEGORIES = [
  'FOOD',
  'TRANSPORT',
  'GROCERIES',
  'LODGING',
  'ACTIVITY',
  'OTHER',
] as const;
export const TransactionCategory = z.enum(TRANSACTION_CATEGORIES);
export type TransactionCategory = z.infer<typeof TransactionCategory>;

export const ACCESS_ROLES = ['PARTICIPANT', 'ADMIN'] as const;
export const AccessRole = z.enum(ACCESS_ROLES);
export type AccessRole = z.infer<typeof AccessRole>;
