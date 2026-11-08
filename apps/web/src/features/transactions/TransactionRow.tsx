import { Link } from 'react-router';
import type { TransactionStatus, TransactionView } from '@nikount/contracts';
import { transactionEmoji } from '../../lib/categories';
import { formatShortDate } from '../../lib/dates';
import { formatMoney } from '../../lib/format';

const STATUS_BADGES: Partial<Record<TransactionStatus, { label: string; className: string }>> = {
  PENDING: { label: '⏳ En attente', className: 'text-amber-700' },
  REJECTED: { label: 'Refusée', className: 'text-slate-500' },
  CANCELLED: { label: 'Annulée', className: 'text-slate-500' },
};

export function StatusBadge({ status }: { status: TransactionStatus }) {
  const badge = STATUS_BADGES[status];
  return badge ? (
    <span className={`text-xs font-semibold ${badge.className}`}>{badge.label}</span>
  ) : null;
}

/** « Alice » pour une dépense ; « Bob → Alice » pour un remboursement. */
export function partiesLabel(transaction: TransactionView, names: Map<string, string>): string {
  const payer = names.get(transaction.payerId) ?? '?';
  if (transaction.type !== 'REIMBURSEMENT') return payer;
  const receiver = names.get(transaction.shares[0]?.participantId ?? '') ?? '?';
  return `${payer} → ${receiver}`;
}

/** Ligne d'historique cliquable vers le détail de l'opération. */
export function TransactionRow({
  transaction,
  names,
  currency,
  basePath,
  showDate = false,
}: {
  transaction: TransactionView;
  names: Map<string, string>;
  currency: string;
  basePath: string;
  showDate?: boolean;
}) {
  const closed = transaction.status === 'CANCELLED' || transaction.status === 'REJECTED';
  return (
    <li>
      <Link
        to={`${basePath}/tx/${transaction.id}`}
        className={`flex min-h-14 items-center gap-3 py-2.5 hover:bg-slate-50 ${closed ? 'opacity-60' : ''}`}
      >
        <span className="text-2xl" aria-hidden="true">
          {transactionEmoji(transaction.type, transaction.category)}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`truncate font-semibold ${closed ? 'line-through' : ''}`}>
            {transaction.description}
          </p>
          <p className="truncate text-sm text-slate-500">
            {partiesLabel(transaction, names)}
            {showDate ? ` · ${formatShortDate(transaction.occurredOn)}` : ''}
          </p>
        </div>
        <div className="text-right">
          <p className={`tabular font-semibold ${closed ? 'line-through' : ''}`}>
            {formatMoney(transaction.amount, currency)}
          </p>
          <StatusBadge status={transaction.status} />
        </div>
      </Link>
    </li>
  );
}
