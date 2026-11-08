import { useState } from 'react';
import type { NikountState, TransactionView } from '@nikount/contracts';
import { isStatusActionAllowedInState } from '@nikount/core';
import { useChangeStatus, type StatusActionPath } from '../../api/transactions';
import { Button } from '../../components/ui';
import { statusErrorMessage } from './status-errors';

/**
 * Actions d'un admin sur une opération : valider ou refuser si elle est en attente, annuler si
 * elle est validée. Refus et annulation demandent une confirmation et acceptent un motif.
 */
export function StatusActions({
  adminToken,
  transaction,
  state,
  compact = false,
}: {
  adminToken: string;
  transaction: TransactionView;
  state: NikountState;
  compact?: boolean;
}) {
  const change = useChangeStatus(adminToken);
  const [confirming, setConfirming] = useState<'reject' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');

  const isPending = transaction.status === 'PENDING';
  const canReview = isPending && isStatusActionAllowedInState('VALIDATE', state);
  const canCancel =
    transaction.status === 'VALIDATED' && isStatusActionAllowedInState('CANCEL', state);
  if (!canReview && !canCancel) return null;

  function run(action: StatusActionPath) {
    change.mutate(
      {
        id: transaction.id,
        action,
        version: transaction.version,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      },
      {
        onSuccess: () => {
          setConfirming(null);
          setReason('');
        },
      },
    );
  }

  const size = compact ? 'min-h-10 px-3 text-sm' : '';

  return (
    <div className={compact ? 'mt-2' : 'mt-4'}>
      {confirming ? (
        <div className="space-y-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <label className="block text-sm font-semibold text-slate-700">
            Motif (facultatif)
            <input
              value={reason}
              maxLength={200}
              autoFocus
              onChange={(event) => {
                setReason(event.target.value);
              }}
              placeholder={confirming === 'reject' ? 'Pas une dépense du groupe…' : 'Doublon…'}
              className="mt-1 block min-h-10 w-full rounded-lg border-0 bg-white px-3 font-normal ring-1 ring-slate-300 ring-inset"
            />
          </label>
          <div className="flex gap-2">
            <Button
              className={`flex-1 bg-red-700 hover:bg-red-800 ${size}`}
              disabled={change.isPending}
              onClick={() => {
                run(confirming);
              }}
            >
              {confirming === 'reject' ? 'Confirmer le refus' : 'Confirmer l’annulation'}
            </Button>
            <Button
              variant="ghost"
              className={size}
              onClick={() => {
                setConfirming(null);
                setReason('');
                change.reset();
              }}
            >
              Retour
            </Button>
          </div>
          {confirming === 'cancel' ? (
            <p className="text-xs text-slate-500">
              L’opération restera visible dans l’historique, barrée, et ne comptera plus dans les
              soldes.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex gap-2">
          {canReview ? (
            <>
              <Button
                className={`flex-1 ${size}`}
                disabled={change.isPending}
                aria-label={`Valider ${transaction.description}`}
                onClick={() => {
                  run('validate');
                }}
              >
                Valider
              </Button>
              <Button
                variant="secondary"
                className={`flex-1 ${size}`}
                disabled={change.isPending}
                aria-label={`Refuser ${transaction.description}`}
                onClick={() => {
                  setConfirming('reject');
                }}
              >
                Refuser
              </Button>
            </>
          ) : null}
          {canCancel ? (
            <Button
              variant="secondary"
              className={`flex-1 ${size}`}
              onClick={() => {
                setConfirming('cancel');
              }}
            >
              Annuler cette opération
            </Button>
          ) : null}
        </div>
      )}
      {change.error ? (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {statusErrorMessage(change.error)}
        </p>
      ) : null}
    </div>
  );
}
