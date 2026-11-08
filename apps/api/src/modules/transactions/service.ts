import type { z } from 'zod';
import type {
  CreateTransactionRequest,
  TransactionRevisionView,
  TransactionView,
  UpdateTransactionRequest,
} from '@nikount/contracts';
import {
  computeSplit,
  isActionAllowed,
  isStatusActionAllowedInState,
  nextStatus,
  SplitError,
  type ComputedShare,
  type DistributionInput,
  type StatusAction,
} from '@nikount/core';
import type { AccessContext, AdminAccessContext } from '../../auth/access.js';
import type { Database } from '../../db/client.js';
import { isUniqueViolation } from '../../lib/db-errors.js';
import { DomainError } from '../../lib/errors.js';
import { uuidv7 } from '../../lib/uuid.js';
import { recordAuditEvent } from '../audit/repository.js';
import { findAdminAccess } from '../nikounts/repository.js';
import { getNikount } from '../nikounts/service.js';
import { listParticipants, type ParticipantRow } from '../participants/repository.js';
import * as repo from './repository.js';

export type CreateTransactionInput = z.output<typeof CreateTransactionRequest>;
export type UpdateTransactionInput = z.output<typeof UpdateTransactionRequest>;

interface RequestMeta {
  requestId: string;
}

const CLIENT_REQUEST_UNIQUE = 'transaction_client_request_unique';

// --- Vues ------------------------------------------------------------------------------------

function toView(
  row: repo.TransactionRow,
  shares: repo.ShareRow[],
  labels: Map<string, string>,
): TransactionView {
  const adminRef = (id: string | null) => (id ? { id, label: labels.get(id) ?? '' } : null);
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    amount: row.amount,
    description: row.description,
    category: row.category,
    occurredOn: row.occurredOn,
    payerId: row.payerId,
    distributionMode: row.distributionMode,
    shares: shares.map((s) => ({
      participantId: s.participantId,
      inputValue: s.inputValue,
      amount: s.amount,
    })),
    createdAt: row.createdAt.toISOString(),
    createdBy: {
      kind: row.createdByKind,
      admin: adminRef(row.createdByAdminId),
      declaredParticipantId: row.declaredByParticipantId,
    },
    validatedAt: row.validatedAt?.toISOString() ?? null,
    validatedBy: adminRef(row.validatedByAdminId),
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
    rejectedBy: adminRef(row.rejectedByAdminId),
    rejectionReason: row.rejectionReason,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelledBy: adminRef(row.cancelledByAdminId),
    cancellationReason: row.cancellationReason,
    version: row.version,
  };
}

async function viewsOf(
  db: Database,
  nikountId: string,
  rows: repo.TransactionRow[],
): Promise<TransactionView[]> {
  const [shares, labels] = await Promise.all([
    repo.listShares(
      db,
      nikountId,
      rows.map((r) => r.id),
    ),
    repo.adminLabels(db, nikountId),
  ]);
  const byTransaction = new Map<string, repo.ShareRow[]>();
  for (const share of shares) {
    byTransaction.set(share.transactionId, [
      ...(byTransaction.get(share.transactionId) ?? []),
      share,
    ]);
  }
  return rows.map((row) => toView(row, byTransaction.get(row.id) ?? [], labels));
}

export async function listTransactions(db: Database, nikountId: string) {
  return viewsOf(db, nikountId, await repo.listTransactions(db, nikountId));
}

export async function getTransaction(
  db: Database,
  nikountId: string,
  transactionId: string,
): Promise<TransactionView> {
  const row = await repo.findTransaction(db, nikountId, transactionId);
  // Introuvable dans CE nikount : même réponse qu'un identifiant inexistant (anti-IDOR).
  if (!row) throw new DomainError(404, 'NOT_FOUND', 'Ressource introuvable.');
  const [view] = await viewsOf(db, nikountId, [row]);
  if (!view) throw new Error('Vue introuvable');
  return view;
}

/** Versions successives d'une opération (la plus ancienne d'abord). */
export async function listRevisions(
  db: Database,
  nikountId: string,
  transactionId: string,
): Promise<TransactionRevisionView[]> {
  if (!(await repo.findTransaction(db, nikountId, transactionId))) {
    throw new DomainError(404, 'NOT_FOUND', 'Ressource introuvable.');
  }
  const [rows, labels] = await Promise.all([
    repo.listRevisions(db, nikountId, transactionId),
    repo.adminLabels(db, nikountId),
  ]);
  return rows.map((row) => ({
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    changedBy: {
      kind: row.changedByKind,
      admin: row.changedByAdminId
        ? { id: row.changedByAdminId, label: labels.get(row.changedByAdminId) ?? '' }
        : null,
      declaredParticipantId: row.declaredByParticipantId,
    },
    reason: row.reason,
  }));
}

// --- Création --------------------------------------------------------------------------------

function concernedIds(distribution: CreateTransactionInput['distribution']): string[] {
  return distribution.mode === 'EQUAL'
    ? distribution.participantIds
    : distribution.shares.map((s) => s.participantId);
}

/**
 * Remet les concernés dans l'ordre d'affichage des participants : c'est cet ordre qui départage
 * les centimes d'arrondi (D2), quel que soit l'ordre envoyé par le client.
 */
function orderedDistribution(
  distribution: CreateTransactionInput['distribution'],
  order: Map<string, number>,
): DistributionInput {
  const rank = (id: string) => order.get(id) ?? Number.MAX_SAFE_INTEGER;
  if (distribution.mode === 'EQUAL') {
    return {
      mode: 'EQUAL',
      participantIds: [...distribution.participantIds].sort((a, b) => rank(a) - rank(b)),
    };
  }
  return {
    mode: distribution.mode,
    shares: [...distribution.shares].sort((a, b) => rank(a.participantId) - rank(b.participantId)),
  };
}

function split(amount: number, distribution: DistributionInput): ComputedShare[] {
  try {
    return computeSplit(amount, distribution);
  } catch (error) {
    if (error instanceof SplitError) {
      throw new DomainError(400, `SPLIT_${error.code}`, error.message, error.details);
    }
    throw error;
  }
}

/** Payeur et concernés admis : participants actifs (et, en modification, ceux déjà présents). */
function validateParties(
  input: Pick<CreateTransactionInput, 'type' | 'payerId' | 'distribution'>,
  active: Map<string, ParticipantRow> | Set<string>,
): void {
  if (!active.has(input.payerId)) {
    throw new DomainError(400, 'PAYER_INVALID', 'Le payeur doit être un participant actif.', {
      payerId: input.payerId,
    });
  }
  const unknown = concernedIds(input.distribution).filter((id) => !active.has(id));
  if (unknown.length > 0) {
    throw new DomainError(
      400,
      'PARTICIPANT_INVALID',
      'Chaque concerné doit être un participant actif.',
      { participantIds: unknown },
    );
  }
  if (input.type === 'REIMBURSEMENT') {
    const concerned = concernedIds(input.distribution);
    if (
      input.distribution.mode !== 'EQUAL' ||
      concerned.length !== 1 ||
      concerned[0] === input.payerId
    ) {
      throw new DomainError(
        400,
        'REIMBURSEMENT_INVALID',
        'Un remboursement va d’une personne vers une seule autre personne.',
      );
    }
  }
}

/** Identité déclarée de l'auteur : admin → son participant ; participant → déclaration vérifiée. */
async function declaredAuthor(
  db: Database,
  access: AccessContext,
  input: CreateTransactionInput,
  active: Map<string, ParticipantRow>,
): Promise<string | null> {
  if (access.adminId) {
    return (await findAdminAccess(db, access.nikountId, access.adminId))?.participantId ?? null;
  }
  const declared = input.declaredByParticipantId ?? null;
  if (declared !== null && !active.has(declared)) {
    throw new DomainError(
      400,
      'DECLARED_PARTICIPANT_INVALID',
      'L’auteur déclaré doit être un participant actif.',
    );
  }
  return declared;
}

/**
 * Crée une opération. Un participant crée une opération EN ATTENTE ; un admin, une opération
 * VALIDÉE d'emblée (règle 8). Idempotent : un `clientRequestId` déjà vu renvoie l'existante.
 */
export async function createTransaction(
  db: Database,
  access: AccessContext,
  input: CreateTransactionInput,
  meta: RequestMeta,
): Promise<{ created: boolean; transaction: TransactionView }> {
  const existing = await repo.findByClientRequestId(db, access.nikountId, input.clientRequestId);
  if (existing) {
    return { created: false, transaction: await getTransaction(db, access.nikountId, existing.id) };
  }

  try {
    const id = await db.transaction(async (tx) => {
      const nikount = await getNikount(tx, access.nikountId, 'share');
      const action = input.type === 'EXPENSE' ? 'CREATE_EXPENSE' : 'CREATE_REIMBURSEMENT';
      if (!isActionAllowed(action, nikount.state)) {
        throw new DomainError(
          409,
          'INVALID_STATE',
          input.type === 'EXPENSE'
            ? 'Les nouvelles dépenses ne sont plus acceptées sur ce nikount.'
            : 'Ce nikount est clôturé.',
          { state: nikount.state },
        );
      }

      const participants = await listParticipants(tx, access.nikountId);
      const active = new Map(participants.filter((p) => p.isActive).map((p) => [p.id, p]));
      validateParties(input, active);
      const declaredBy = await declaredAuthor(tx, access, input, active);

      const order = new Map(participants.map((p) => [p.id, p.sortOrder]));
      const shares = split(input.amount, orderedDistribution(input.distribution, order));

      const isAdmin = access.role === 'ADMIN' && access.adminId !== null;
      const now = new Date();
      const transactionId = uuidv7();
      const row = await repo.insertTransaction(tx, {
        id: transactionId,
        nikountId: access.nikountId,
        type: input.type,
        status: isAdmin ? 'VALIDATED' : 'PENDING',
        amount: input.amount,
        description: input.description,
        category: input.category,
        occurredOn: input.occurredOn,
        payerId: input.payerId,
        distributionMode: input.distribution.mode,
        createdByKind: isAdmin ? 'ADMIN' : 'PARTICIPANT',
        createdByAdminId: access.adminId,
        declaredByParticipantId: declaredBy,
        clientRequestId: input.clientRequestId,
        validatedAt: isAdmin ? now : null,
        validatedByAdminId: isAdmin ? access.adminId : null,
      });
      const shareRows = await repo.insertShares(
        tx,
        shares.map((share) => ({
          id: uuidv7(),
          transactionId,
          nikountId: access.nikountId,
          participantId: share.participantId,
          inputValue: share.inputValue,
          amount: share.amount,
        })),
      );

      const snapshot = toView(row, shareRows, new Map());
      await repo.insertRevision(tx, {
        id: uuidv7(),
        transactionId,
        nikountId: access.nikountId,
        revision: 1,
        snapshot: { snapshotVersion: 1, ...snapshot },
        changedByKind: isAdmin ? 'ADMIN' : 'PARTICIPANT',
        changedByAdminId: access.adminId,
        declaredByParticipantId: declaredBy,
      });
      await recordAuditEvent(tx, {
        nikountId: access.nikountId,
        actorKind: isAdmin ? 'ADMIN' : 'PARTICIPANT',
        actorAdminId: access.adminId,
        actorParticipantId: declaredBy,
        action: 'transaction.created',
        entityType: 'transaction',
        entityId: transactionId,
        data: {
          type: input.type,
          status: row.status,
          amount: input.amount,
          description: input.description,
          payerId: input.payerId,
          distributionMode: input.distribution.mode,
        },
        requestId: meta.requestId,
      });
      return transactionId;
    });

    return { created: true, transaction: await getTransaction(db, access.nikountId, id) };
  } catch (error) {
    // Deux envois simultanés de la même saisie : le second renvoie l'opération du premier.
    if (isUniqueViolation(error, CLIENT_REQUEST_UNIQUE)) {
      const winner = await repo.findByClientRequestId(db, access.nikountId, input.clientRequestId);
      if (winner) {
        return {
          created: false,
          transaction: await getTransaction(db, access.nikountId, winner.id),
        };
      }
    }
    throw error;
  }
}

// --- Changements de statut -------------------------------------------------------------------

const STATUS_ACTION_AUDIT: Record<StatusAction, string> = {
  VALIDATE: 'transaction.validated',
  REJECT: 'transaction.rejected',
  CANCEL: 'transaction.cancelled',
};

function statusFields(
  action: StatusAction,
  adminId: string,
  reason: string | null,
  now: Date,
): Partial<repo.TransactionRow> {
  switch (action) {
    case 'VALIDATE':
      return { status: 'VALIDATED', validatedAt: now, validatedByAdminId: adminId };
    case 'REJECT':
      return {
        status: 'REJECTED',
        rejectedAt: now,
        rejectedByAdminId: adminId,
        rejectionReason: reason,
      };
    case 'CANCEL':
      return {
        status: 'CANCELLED',
        cancelledAt: now,
        cancelledByAdminId: adminId,
        cancellationReason: reason,
      };
  }
}

/**
 * Valide, refuse ou annule une ou plusieurs opérations, en TOUT OU RIEN : si l'une d'elles est
 * introuvable, déjà dans un statut incompatible ou modifiée entre-temps, aucune ne change.
 * Réservé aux admins. Une opération n'est jamais supprimée : annuler la garde dans l'historique.
 */
export async function changeStatus(
  db: Database,
  access: AdminAccessContext,
  transactionIds: string[],
  action: StatusAction,
  options: { reason?: string | undefined; version?: number | undefined },
  meta: RequestMeta,
): Promise<TransactionView[]> {
  const ids = [...new Set(transactionIds)];
  const reason = action === 'VALIDATE' ? null : (options.reason ?? null);

  await db.transaction(async (tx) => {
    const nikount = await getNikount(tx, access.nikountId, 'share');
    if (!isStatusActionAllowedInState(action, nikount.state)) {
      throw new DomainError(
        409,
        'INVALID_STATE',
        'Ce nikount est clôturé : plus aucun changement.',
        {
          state: nikount.state,
        },
      );
    }

    const rows = await repo.lockTransactions(tx, access.nikountId, ids);
    const found = new Set(rows.map((r) => r.id));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new DomainError(404, 'NOT_FOUND', 'Ressource introuvable.', { ids: missing });
    }

    if (options.version !== undefined) {
      const stale = rows.filter((r) => r.version !== options.version);
      if (stale.length > 0) {
        throw new DomainError(
          409,
          'VERSION_CONFLICT',
          'Cette opération a été modifiée entre-temps.',
          {
            currentVersion: stale[0]?.version,
          },
        );
      }
    }

    const blocked = rows.filter((r) => nextStatus(r.status, action) === null);
    if (blocked.length > 0) {
      throw new DomainError(
        409,
        'INVALID_STATUS_TRANSITION',
        'Ce changement de statut n’est pas possible pour au moins une opération.',
        { transactions: blocked.map((r) => ({ id: r.id, status: r.status })) },
      );
    }

    const now = new Date();
    for (const row of rows) {
      const updated = await repo.updateStatus(
        tx,
        access.nikountId,
        row,
        statusFields(action, access.adminId, reason, now),
      );
      if (!updated) {
        throw new DomainError(
          409,
          'VERSION_CONFLICT',
          'Cette opération a été modifiée entre-temps.',
        );
      }
      await recordAuditEvent(tx, {
        nikountId: access.nikountId,
        actorKind: 'ADMIN',
        actorAdminId: access.adminId,
        action: STATUS_ACTION_AUDIT[action],
        entityType: 'transaction',
        entityId: row.id,
        data: {
          from: row.status,
          to: updated.status,
          ...(reason ? { reason } : {}),
          ...(ids.length > 1 ? { bulk: true, count: ids.length } : {}),
        },
        requestId: meta.requestId,
      });
    }
  });

  const views = await viewsOf(
    db,
    access.nikountId,
    await repo.findTransactions(db, access.nikountId, ids),
  );
  const byId = new Map(views.map((v) => [v.id, v]));
  return ids.map((id) => byId.get(id)).filter((v): v is TransactionView => v !== undefined);
}

// --- Modification (admin) --------------------------------------------------------------------

/** Statuts modifiables : une opération refusée ou annulée reste telle quelle (historique). */
const EDITABLE_STATUSES = new Set<repo.TransactionRow['status']>(['PENDING', 'VALIDATED']);

function sameShares(a: repo.ShareRow[], b: ComputedShare[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(a.map((s) => [s.participantId, s]));
  return b.every((s) => {
    const old = byId.get(s.participantId);
    return old !== undefined && old.amount === s.amount && old.inputValue === s.inputValue;
  });
}

/**
 * Remplace le contenu d'une opération en attente ou validée (montant, payeur, répartition,
 * description, date, catégorie) sans changer son type ni son statut — D13 : modification en place
 * avec révision. Les soldes suivent d'eux-mêmes, puisqu'ils sont calculés depuis les parts.
 * Le payeur et les concernés doivent être actifs, sauf s'ils figuraient déjà dans l'opération
 * (corriger une vieille dépense ne doit pas obliger à réactiver quelqu'un).
 */
export async function updateTransaction(
  db: Database,
  access: AdminAccessContext,
  transactionId: string,
  input: UpdateTransactionInput,
  meta: RequestMeta,
): Promise<TransactionView> {
  await db.transaction(async (tx) => {
    const nikount = await getNikount(tx, access.nikountId, 'share');
    if (!isActionAllowed('EDIT_OR_CANCEL', nikount.state)) {
      throw new DomainError(
        409,
        'INVALID_STATE',
        'Ce nikount est clôturé : plus aucun changement.',
        {
          state: nikount.state,
        },
      );
    }

    const [current] = await repo.lockTransactions(tx, access.nikountId, [transactionId]);
    if (!current) throw new DomainError(404, 'NOT_FOUND', 'Ressource introuvable.');
    if (current.version !== input.version) {
      throw new DomainError(
        409,
        'VERSION_CONFLICT',
        'Cette opération a été modifiée entre-temps.',
        {
          currentVersion: current.version,
        },
      );
    }
    if (!EDITABLE_STATUSES.has(current.status)) {
      throw new DomainError(
        409,
        'NOT_EDITABLE',
        'Une opération refusée ou annulée ne se modifie plus.',
        { status: current.status },
      );
    }

    const participants = await listParticipants(tx, access.nikountId);
    const currentShares = await repo.sharesOf(tx, access.nikountId, current.id);
    const allowed = new Set([
      ...participants.filter((p) => p.isActive).map((p) => p.id),
      current.payerId,
      ...currentShares.map((s) => s.participantId),
    ]);
    validateParties({ ...input, type: current.type }, allowed);

    const order = new Map(participants.map((p) => [p.id, p.sortOrder]));
    const shares = split(input.amount, orderedDistribution(input.distribution, order));

    const changed: string[] = [];
    const fields = ['amount', 'description', 'category', 'occurredOn', 'payerId'] as const;
    for (const key of fields) if (current[key] !== input[key]) changed.push(key);
    if (current.distributionMode !== input.distribution.mode) changed.push('distributionMode');
    if (!sameShares(currentShares, shares)) changed.push('shares');
    // Rien à changer : pas de nouvelle révision ni d'événement.
    if (changed.length === 0) return;

    const result = await repo.replaceContent(
      tx,
      access.nikountId,
      current,
      {
        amount: input.amount,
        description: input.description,
        category: input.category,
        occurredOn: input.occurredOn,
        payerId: input.payerId,
        distributionMode: input.distribution.mode,
      },
      shares.map((share) => ({
        id: uuidv7(),
        transactionId: current.id,
        nikountId: access.nikountId,
        participantId: share.participantId,
        inputValue: share.inputValue,
        amount: share.amount,
      })),
    );
    if (!result) {
      throw new DomainError(409, 'VERSION_CONFLICT', 'Cette opération a été modifiée entre-temps.');
    }

    const reason = input.reason ?? null;
    const declaredBy =
      (await findAdminAccess(tx, access.nikountId, access.adminId))?.participantId ?? null;
    await repo.insertRevision(tx, {
      id: uuidv7(),
      transactionId: current.id,
      nikountId: access.nikountId,
      revision: (await repo.lastRevision(tx, access.nikountId, current.id)) + 1,
      snapshot: { snapshotVersion: 1, ...toView(result.row, result.shares, new Map()) },
      changedByKind: 'ADMIN',
      changedByAdminId: access.adminId,
      declaredByParticipantId: declaredBy,
      reason,
    });
    await recordAuditEvent(tx, {
      nikountId: access.nikountId,
      actorKind: 'ADMIN',
      actorAdminId: access.adminId,
      action: 'transaction.updated',
      entityType: 'transaction',
      entityId: current.id,
      data: {
        changed,
        before: Object.fromEntries(
          changed.filter((k) => k !== 'shares').map((k) => [k, current[k as keyof typeof current]]),
        ),
        after: Object.fromEntries(
          changed
            .filter((k) => k !== 'shares')
            .map((k) => [
              k,
              k === 'distributionMode'
                ? input.distribution.mode
                : input[k as (typeof fields)[number]],
            ]),
        ),
        ...(reason ? { reason } : {}),
      },
      requestId: meta.requestId,
    });
  });

  return getTransaction(db, access.nikountId, transactionId);
}
