import { z } from 'zod';
import {
  ActorKind,
  DistributionMode,
  TransactionCategory,
  TransactionStatus,
  TransactionType,
} from './enums.js';
import { cleanText } from './text.js';

/** Montant maximal d'une opération, en unités mineures (1 000 000,00). */
export const MAX_AMOUNT = 100_000_000;
const MAX_CONCERNED = 200;

/** Nombre à 2 décimales au plus (parts, pourcentages), tolérant aux imprécisions flottantes. */
const twoDecimals = z
  .number()
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
    message: '2 décimales au plus',
  });

const MinorAmount = z.number().int().min(1).max(MAX_AMOUNT);

const ShareEntry = <T extends z.ZodType<number>>(value: T) =>
  z.strictObject({ participantId: z.uuid(), value });

/**
 * Répartition saisie. Le client n'envoie jamais les montants calculés (sauf en mode AMOUNT,
 * où ce sont les valeurs saisies) : le serveur les recalcule avec @nikount/core.
 */
export const DistributionRequest = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('EQUAL'),
    participantIds: z.array(z.uuid()).min(1).max(MAX_CONCERNED),
  }),
  z.strictObject({
    mode: z.literal('SHARES'),
    shares: z
      .array(ShareEntry(twoDecimals.pipe(z.number().gt(0).max(10_000))))
      .min(1)
      .max(MAX_CONCERNED),
  }),
  z.strictObject({
    mode: z.literal('PERCENT'),
    shares: z
      .array(ShareEntry(twoDecimals.pipe(z.number().gt(0).max(100))))
      .min(1)
      .max(MAX_CONCERNED),
  }),
  z.strictObject({
    mode: z.literal('AMOUNT'),
    shares: z
      .array(ShareEntry(z.number().int().min(0).max(MAX_AMOUNT)))
      .min(1)
      .max(MAX_CONCERNED),
  }),
]);
export type DistributionRequest = z.infer<typeof DistributionRequest>;

/** Date métier (jour de l'événement), sans heure. */
export const OccurredOn = z.iso
  .date()
  .refine((value) => value >= '2000-01-01' && value <= '2100-12-31', 'Date hors limites');

export const CreateTransactionRequest = z.strictObject({
  /** Généré à l'ouverture du formulaire : un double envoi ne crée qu'une opération. */
  clientRequestId: z.uuid(),
  type: TransactionType,
  amount: MinorAmount,
  description: cleanText(1, 80),
  category: TransactionCategory.nullable().default(null),
  occurredOn: OccurredOn,
  payerId: z.uuid(),
  distribution: DistributionRequest,
  /** Identité déclarée de l'auteur (participant). Ignorée pour un admin. */
  declaredByParticipantId: z.uuid().optional(),
});
export type CreateTransactionRequest = z.input<typeof CreateTransactionRequest>;

export const TransactionShareView = z.object({
  participantId: z.uuid(),
  inputValue: z.number(),
  amount: z.number().int(),
});
export type TransactionShareView = z.infer<typeof TransactionShareView>;

const AdminRef = z.object({ id: z.uuid(), label: z.string() }).nullable();

export const TransactionView = z.object({
  id: z.uuid(),
  type: TransactionType,
  status: TransactionStatus,
  amount: z.number().int(),
  description: z.string(),
  category: TransactionCategory.nullable(),
  occurredOn: z.string(),
  payerId: z.uuid(),
  distributionMode: DistributionMode,
  shares: z.array(TransactionShareView),
  createdAt: z.iso.datetime({ offset: true }),
  createdBy: z.object({
    kind: ActorKind,
    admin: AdminRef,
    declaredParticipantId: z.uuid().nullable(),
  }),
  validatedAt: z.iso.datetime({ offset: true }).nullable(),
  validatedBy: AdminRef,
  rejectedAt: z.iso.datetime({ offset: true }).nullable(),
  rejectedBy: AdminRef,
  rejectionReason: z.string().nullable(),
  cancelledAt: z.iso.datetime({ offset: true }).nullable(),
  cancelledBy: AdminRef,
  cancellationReason: z.string().nullable(),
  version: z.number().int(),
});
export type TransactionView = z.infer<typeof TransactionView>;

/** Une version de l'opération (création puis chaque modification) — docs/product.md §9. */
export const TransactionRevisionView = z.object({
  revision: z.number().int(),
  createdAt: z.iso.datetime({ offset: true }),
  changedBy: z.object({
    kind: ActorKind,
    admin: AdminRef,
    declaredParticipantId: z.uuid().nullable(),
  }),
  reason: z.string().nullable(),
});
export type TransactionRevisionView = z.infer<typeof TransactionRevisionView>;

export const TransactionRevisionListResponse = z.object({
  revisions: z.array(TransactionRevisionView),
});
export type TransactionRevisionListResponse = z.infer<typeof TransactionRevisionListResponse>;

export const TransactionListResponse = z.object({
  transactions: z.array(TransactionView),
});
export type TransactionListResponse = z.infer<typeof TransactionListResponse>;

export const TransactionIdParams = z.strictObject({ id: z.uuid() });

// --- Changements de statut (docs/product.md §10) ---------------------------------------------

const Reason = cleanText(1, 200);

/**
 * Valider, refuser ou annuler une opération. `version` (facultative) protège d'un changement
 * concurrent : si elle ne correspond plus, la réponse est 409 VERSION_CONFLICT.
 */
export const StatusChangeRequest = z.preprocess(
  // Corps absent (Fastify transmet null) : aucune option, ce qui suffit pour valider.
  (body) => body ?? {},
  z.strictObject({
    reason: Reason.optional(),
    version: z.number().int().min(1).optional(),
  }),
);
export type StatusChangeRequest = z.input<typeof StatusChangeRequest>;

export const BULK_STATUS_ACTIONS = ['validate', 'reject', 'cancel'] as const;
export const BulkStatusAction = z.enum(BULK_STATUS_ACTIONS);
export type BulkStatusAction = z.infer<typeof BulkStatusAction>;

/** Action en masse, tout ou rien : si une opération ne peut pas changer, aucune ne change. */
export const BulkStatusRequest = z.strictObject({
  action: BulkStatusAction,
  ids: z.array(z.uuid()).min(1).max(200),
  reason: Reason.optional(),
});
export type BulkStatusRequest = z.input<typeof BulkStatusRequest>;

// --- Modification (admin, docs/product.md §9 et D13) -----------------------------------------

/**
 * Remplacement complet d'une opération : tout ce qui se saisit, sauf le type. Le statut ne change
 * pas. `version` est obligatoire (verrouillage optimiste) ; `reason` est gardé dans la révision.
 */
export const UpdateTransactionRequest = z.strictObject({
  amount: MinorAmount,
  description: cleanText(1, 80),
  category: TransactionCategory.nullable(),
  occurredOn: OccurredOn,
  payerId: z.uuid(),
  distribution: DistributionRequest,
  version: z.number().int().min(1),
  reason: Reason.optional(),
});
export type UpdateTransactionRequest = z.input<typeof UpdateTransactionRequest>;
