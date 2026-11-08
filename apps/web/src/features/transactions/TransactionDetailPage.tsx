import { Link, useParams } from 'react-router';
import { isActionAllowed } from '@nikount/core';
import type {
  DistributionMode,
  MeResponse,
  TransactionRevisionView,
  TransactionView,
} from '@nikount/contracts';
import { ApiError } from '../../api/client';
import { useParticipants } from '../../api/participants';
import { StatusActions } from '../review/StatusActions';
import { useTransaction, useTransactionRevisions } from '../../api/transactions';
import { Card, PageShell } from '../../components/ui';
import { CATEGORIES, transactionEmoji } from '../../lib/categories';
import { dayLabel } from '../../lib/history';
import { formatDateTime, todayIn } from '../../lib/dates';
import { formatMoney } from '../../lib/format';
import { isEditable } from '../../lib/operations';

const MODE_LABELS: Record<DistributionMode, string> = {
  EQUAL: 'Égalitaire',
  SHARES: 'Par parts',
  PERCENT: 'Par pourcentage',
  AMOUNT: 'Par montant',
};

const decimal = (value: number) => String(value).replace('.', ',');

/** « 2 parts → », « 30 % → », rien pour l'égalitaire et le montant libre. */
export function inputLabel(mode: DistributionMode, inputValue: number): string | null {
  switch (mode) {
    case 'SHARES':
      return `${decimal(inputValue)} part${inputValue >= 2 ? 's' : ''}`;
    case 'PERCENT':
      return `${decimal(inputValue)} %`;
    case 'EQUAL':
    case 'AMOUNT':
      return null;
  }
}

/** Détail d'une opération (docs/product.md §8) : qui a payé, pour qui, comment, et sa traçabilité. */
export function TransactionDetailPage({
  token,
  me,
  basePath,
}: {
  token: string;
  me: MeResponse;
  basePath: string;
}) {
  const { transactionId = '' } = useParams();
  return (
    <PageShell>
      <Link to={`${basePath}/history`} className="self-start text-sm font-semibold text-brand-700">
        ← Historique
      </Link>
      <TransactionDetail
        token={token}
        me={me}
        transactionId={transactionId}
        editPath={`${basePath}/tx/${transactionId}/edit`}
      />
    </PageShell>
  );
}

/**
 * Contenu du détail, utilisé par la page et par le panneau latéral de la table desktop.
 * « Modifier » (admin) mène à `editPath` ou appelle `onEdit`.
 */
export function TransactionDetail({
  token,
  me,
  transactionId,
  editPath,
  onEdit,
}: {
  token: string;
  me: MeResponse;
  transactionId: string;
  editPath?: string;
  onEdit?: () => void;
}) {
  const transaction = useTransaction(token, transactionId);
  const revisions = useTransactionRevisions(token, transactionId);
  const participants = useParticipants(token);
  const names = new Map((participants.data ?? []).map((p) => [p.id, p.name]));

  return (
    <>
      {transaction.data ? (
        <Detail
          token={token}
          transaction={transaction.data}
          revisions={revisions.data ?? []}
          names={names}
          me={me}
          editPath={editPath}
          onEdit={onEdit}
        />
      ) : transaction.error ? (
        <p className="mt-10 text-center text-slate-600">
          {transaction.error instanceof ApiError && transaction.error.status === 404
            ? 'Cette opération n’existe pas dans ce nikount.'
            : 'Impossible de charger cette opération.'}
        </p>
      ) : (
        <p className="mt-10 text-center text-slate-500" role="status">
          Chargement…
        </p>
      )}
    </>
  );
}

function Detail({
  token,
  transaction: t,
  revisions,
  names,
  me,
  editPath,
  onEdit,
}: {
  token: string;
  transaction: TransactionView;
  revisions: TransactionRevisionView[];
  names: Map<string, string>;
  me: MeResponse;
  editPath?: string | undefined;
  onEdit?: (() => void) | undefined;
}) {
  const { currency, timezone } = me.nikount;
  const name = (id: string | null) => (id ? (names.get(id) ?? '?') : '?');
  const when = (iso: string) => formatDateTime(iso, timezone);
  const isReimbursement = t.type === 'REIMBURSEMENT';
  const closed = t.status === 'CANCELLED' || t.status === 'REJECTED';
  const category = CATEGORIES.find((c) => c.value === t.category);

  return (
    <>
      <header className="mt-6 text-center">
        <p className="text-5xl" aria-hidden="true">
          {transactionEmoji(t.type, t.category)}
        </p>
        <h1 className={`mt-2 text-2xl font-bold ${closed ? 'line-through' : ''}`}>
          {t.description}
        </h1>
        <p
          className={`tabular mt-1 text-4xl font-bold ${closed ? 'text-slate-400 line-through' : ''}`}
        >
          {formatMoney(t.amount, currency)}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          {dayLabel(t.occurredOn, todayIn(timezone))}
          {category ? ` · ${category.label}` : ''}
          {isReimbursement ? ' · Remboursement' : ''}
        </p>
      </header>

      <StatusPanel transaction={t} when={when} />
      {me.role === 'ADMIN' ? (
        <StatusActions adminToken={token} transaction={t} state={me.nikount.state} />
      ) : null}
      {me.role === 'ADMIN' &&
      isEditable(t) &&
      isActionAllowed('EDIT_OR_CANCEL', me.nikount.state) ? (
        onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="mt-3 w-full rounded-2xl py-2.5 text-sm font-semibold text-brand-700 ring-1 ring-brand-700/30 hover:bg-brand-50"
          >
            ✏️ Modifier
          </button>
        ) : editPath ? (
          <Link
            to={editPath}
            className="mt-3 block rounded-2xl py-2.5 text-center text-sm font-semibold text-brand-700 ring-1 ring-brand-700/30 hover:bg-brand-50"
          >
            ✏️ Modifier
          </Link>
        ) : null
      ) : null}

      <Card className="mt-4">
        <p>
          {isReimbursement ? (
            <>
              <strong>{name(t.payerId)}</strong> a remboursé{' '}
              <strong>{name(t.shares[0]?.participantId ?? null)}</strong>
            </>
          ) : (
            <>
              Payé par <strong>{name(t.payerId)}</strong>
            </>
          )}
        </p>

        {!isReimbursement ? (
          <>
            <h2 className="mt-4 text-xs font-bold tracking-wider text-slate-500 uppercase">
              Concernés · {MODE_LABELS[t.distributionMode]}
            </h2>
            <ul className="mt-1">
              {t.shares.map((share) => {
                const input = inputLabel(t.distributionMode, share.inputValue);
                return (
                  <li key={share.participantId} className="flex justify-between gap-2 py-1">
                    <span className="min-w-0 truncate">{name(share.participantId)}</span>
                    <span className="tabular shrink-0">
                      {input ? <span className="text-slate-500">{input} → </span> : null}
                      <strong>{formatMoney(share.amount, currency)}</strong>
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </Card>

      <Card className="mt-4 text-sm text-slate-600">
        <h2 className="text-xs font-bold tracking-wider text-slate-500 uppercase">Traçabilité</h2>
        <ul className="mt-2 space-y-1">
          {revisions.length > 0 ? (
            revisions.map((revision) => (
              <li key={revision.revision}>
                {revision.revision === 1
                  ? 'Saisie'
                  : `Modifiée (version ${String(revision.revision)})`}{' '}
                {authorLabel(revision.changedBy, name)} · {when(revision.createdAt)}
                {revision.reason ? ` — « ${revision.reason} »` : ''}
              </li>
            ))
          ) : (
            <li>
              Saisie {authorLabel(t.createdBy, name)} · {when(t.createdAt)}
            </li>
          )}
        </ul>
      </Card>
    </>
  );
}

function authorLabel(
  author: TransactionView['createdBy'],
  name: (id: string | null) => string,
): string {
  if (author.admin) return `par ${author.admin.label} (admin)`;
  if (author.declaredParticipantId) return `par ${name(author.declaredParticipantId)}`;
  return 'depuis le lien du groupe';
}

function StatusPanel({
  transaction: t,
  when,
}: {
  transaction: TransactionView;
  when: (iso: string) => string;
}) {
  const reason = (text: string | null) =>
    text ? <p className="mt-1">Motif : « {text} »</p> : null;
  switch (t.status) {
    case 'PENDING':
      return (
        <p className="mt-6 rounded-xl bg-amber-50 p-3 text-center text-sm text-amber-800">
          ⏳ En attente de validation : pas encore comptée dans les soldes.
        </p>
      );
    case 'VALIDATED':
      return (
        <p className="mt-6 rounded-xl bg-emerald-50 p-3 text-center text-sm text-emerald-800">
          ✓ Validée{t.validatedBy ? ` par ${t.validatedBy.label}` : ''}
          {t.validatedAt ? ` · ${when(t.validatedAt)}` : ''}
        </p>
      );
    case 'REJECTED':
      return (
        <div className="mt-6 rounded-xl bg-slate-100 p-3 text-center text-sm text-slate-700">
          <p>
            Refusée{t.rejectedBy ? ` par ${t.rejectedBy.label}` : ''}
            {t.rejectedAt ? ` · ${when(t.rejectedAt)}` : ''} — non comptée.
          </p>
          {reason(t.rejectionReason)}
        </div>
      );
    case 'CANCELLED':
      return (
        <div className="mt-6 rounded-xl bg-slate-100 p-3 text-center text-sm text-slate-700">
          <p>
            Annulée{t.cancelledBy ? ` par ${t.cancelledBy.label}` : ''}
            {t.cancelledAt ? ` · ${when(t.cancelledAt)}` : ''} — non comptée.
          </p>
          {reason(t.cancellationReason)}
        </div>
      );
  }
}
