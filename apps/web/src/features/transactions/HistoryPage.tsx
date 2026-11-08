import { Link, useSearchParams } from 'react-router';
import type { MeResponse } from '@nikount/contracts';
import { useParticipants } from '../../api/participants';
import { useTransactions } from '../../api/transactions';
import { PageShell } from '../../components/ui';
import { todayIn } from '../../lib/dates';
import { formatMoney } from '../../lib/format';
import {
  FILTER_LABELS,
  groupByDay,
  HISTORY_FILTERS,
  matchesFilter,
  parseFilter,
} from '../../lib/history';
import { TransactionRow } from './TransactionRow';

/** Historique complet, groupé par jour, filtrable (docs/product.md §8). */
export function HistoryPage({
  token,
  me,
  basePath,
}: {
  token: string;
  me: MeResponse;
  basePath: string;
}) {
  const [params] = useSearchParams();
  const filter = parseFilter(params.get('filter'));
  const transactions = useTransactions(token);
  const participants = useParticipants(token);
  const names = new Map((participants.data ?? []).map((p) => [p.id, p.name]));
  const currency = me.nikount.currency;

  const visible = (transactions.data ?? []).filter((t) => matchesFilter(t, filter));
  const groups = groupByDay(visible, todayIn(me.nikount.timezone));
  const total = visible
    .filter((t) => t.status === 'VALIDATED')
    .reduce((sum, t) => sum + t.amount, 0);

  return (
    <PageShell>
      <h1 className="text-2xl font-bold">Historique</h1>

      <nav
        aria-label="Filtres"
        className="-mx-5 mt-4 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <ul className="flex gap-2 pb-1">
          {HISTORY_FILTERS.map((f) => (
            <li key={f} className="shrink-0">
              <Link
                to={f === 'ALL' ? `${basePath}/history` : `${basePath}/history?filter=${f}`}
                aria-current={f === filter ? 'page' : undefined}
                className="inline-flex min-h-10 items-center rounded-full bg-white px-4 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 aria-[current=page]:bg-brand-700 aria-[current=page]:text-white aria-[current=page]:ring-brand-700"
              >
                {FILTER_LABELS[f]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {transactions.isError ? (
        <p role="alert" className="mt-6 text-sm text-red-600">
          Impossible de charger l’historique.
        </p>
      ) : !transactions.data ? (
        <p className="mt-6 text-sm text-slate-500" role="status">
          Chargement…
        </p>
      ) : groups.length === 0 ? (
        <p className="mt-10 text-center text-slate-500">Aucune opération ici pour l’instant.</p>
      ) : (
        <>
          {filter === 'EXPENSE' || filter === 'REIMBURSEMENT' ? (
            <p className="mt-4 text-sm text-slate-600">
              Total validé : <strong className="tabular">{formatMoney(total, currency)}</strong>
            </p>
          ) : null}
          {groups.map((group) => (
            <section key={group.date} className="mt-6" aria-label={group.label}>
              <h2 className="text-sm font-bold text-slate-500">{group.label}</h2>
              <ul className="mt-1 divide-y divide-slate-100 rounded-2xl bg-white px-4 ring-1 ring-slate-200">
                {group.transactions.map((t) => (
                  <TransactionRow
                    key={t.id}
                    transaction={t}
                    names={names}
                    currency={currency}
                    basePath={basePath}
                  />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </PageShell>
  );
}
