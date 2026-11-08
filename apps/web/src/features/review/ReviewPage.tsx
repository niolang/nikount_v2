import { useState } from 'react';
import { Link } from 'react-router';
import type { MeResponse } from '@nikount/contracts';
import { isStatusActionAllowedInState } from '@nikount/core';
import { useParticipants } from '../../api/participants';
import { useBulkStatus, useTransactions } from '../../api/transactions';
import { Button, Card, PageShell } from '../../components/ui';
import { transactionEmoji } from '../../lib/categories';
import { formatShortDate } from '../../lib/dates';
import { formatMoney } from '../../lib/format';
import { partiesLabel } from '../transactions/TransactionRow';
import { statusErrorMessage } from './status-errors';
import { StatusActions } from './StatusActions';

/**
 * File de validation de l'admin (docs/product.md §13) : opérations en attente, validation ou
 * refus unitaires, et « Valider tout » (tout ou rien).
 */
export function ReviewPage({
  token,
  me,
  basePath,
}: {
  token: string;
  me: MeResponse;
  basePath: string;
}) {
  const transactions = useTransactions(token);
  const participants = useParticipants(token);
  const bulk = useBulkStatus(token);
  const [confirmAll, setConfirmAll] = useState(false);
  const names = new Map((participants.data ?? []).map((p) => [p.id, p.name]));
  const { currency, state } = me.nikount;

  const pending = (transactions.data ?? []).filter((t) => t.status === 'PENDING');
  const total = pending.reduce((sum, t) => sum + t.amount, 0);
  const canReview = isStatusActionAllowedInState('VALIDATE', state);

  return (
    <PageShell>
      <Link to={basePath} className="self-start text-sm font-semibold text-brand-700">
        ← {me.nikount.name}
      </Link>
      <h1 className="mt-4 text-2xl font-bold">À valider</h1>

      {!transactions.data ? (
        <p className="mt-6 text-sm text-slate-500" role="status">
          {transactions.isError ? 'Impossible de charger les opérations.' : 'Chargement…'}
        </p>
      ) : pending.length === 0 ? (
        <p className="mt-10 text-center text-slate-600">Rien à valider. ✅</p>
      ) : (
        <>
          <p className="mt-2 text-slate-600">
            {pending.length} opération{pending.length > 1 ? 's' : ''} en attente ·{' '}
            <strong className="tabular">{formatMoney(total, currency)}</strong>
          </p>

          {canReview && pending.length > 1 ? (
            <div className="mt-4">
              {confirmAll ? (
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    disabled={bulk.isPending}
                    onClick={() => {
                      bulk.mutate(
                        { action: 'validate', ids: pending.map((t) => t.id) },
                        {
                          onSettled: () => {
                            setConfirmAll(false);
                          },
                        },
                      );
                    }}
                  >
                    Confirmer : valider les {pending.length}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setConfirmAll(false);
                    }}
                  >
                    Retour
                  </Button>
                </div>
              ) : (
                <Button
                  className="w-full"
                  onClick={() => {
                    bulk.reset();
                    setConfirmAll(true);
                  }}
                >
                  Valider tout ({pending.length})
                </Button>
              )}
              {bulk.error ? (
                <p role="alert" className="mt-2 text-sm text-red-600">
                  {statusErrorMessage(bulk.error)} Aucune opération n’a été modifiée.
                </p>
              ) : null}
            </div>
          ) : null}

          <ul className="mt-4 space-y-3">
            {pending.map((t) => (
              <li key={t.id}>
                <Card className="p-4">
                  <Link to={`${basePath}/tx/${t.id}`} className="flex items-center gap-3">
                    <span className="text-2xl" aria-hidden="true">
                      {transactionEmoji(t.type, t.category)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{t.description}</p>
                      <p className="truncate text-sm text-slate-500">
                        {partiesLabel(t, names)} · {formatShortDate(t.occurredOn)}
                        {t.createdBy.declaredParticipantId
                          ? ` · saisie par ${names.get(t.createdBy.declaredParticipantId) ?? '?'}`
                          : ''}
                      </p>
                    </div>
                    <p className="tabular font-semibold">{formatMoney(t.amount, currency)}</p>
                  </Link>
                  <StatusActions adminToken={token} transaction={t} state={state} compact />
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </PageShell>
  );
}
