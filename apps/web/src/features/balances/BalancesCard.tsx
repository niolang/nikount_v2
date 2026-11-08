import type { BalancesResponse, NikountState, ParticipantView } from '@nikount/contracts';
import { Link } from 'react-router';
import { Card } from '../../components/ui';
import { formatMoney } from '../../lib/format';

/**
 * Vue principale des soldes (docs/product.md §7 et §10) : « qui doit recevoir, qui doit payer ».
 * Les suggestions sont des aides d'affichage : elles ne modifient jamais les comptes.
 */
export function BalancesCard({
  balances,
  participants,
  currentId,
  currency,
  state,
  reimbursementPath = null,
}: {
  balances: BalancesResponse;
  participants: ParticipantView[];
  currentId: string | null;
  currency: string;
  state: NikountState;
  /** Chemin du formulaire de remboursement ; null si les remboursements sont impossibles. */
  reimbursementPath?: string | null;
}) {
  const byId = new Map(participants.map((p) => [p.id, p]));
  const name = (id: string) => {
    const participant = byId.get(id);
    if (!participant) return '?';
    const suffix = id === currentId ? ' (vous)' : participant.isActive ? '' : ' (désactivé)';
    return `${participant.name}${suffix}`;
  };
  const money = (amount: number, signed = false) => formatMoney(amount, currency, { signed });

  const toReceive = balances.balances
    .filter((b) => b.balance > 0)
    .sort((a, b) => b.balance - a.balance);
  const toPay = balances.balances
    .filter((b) => b.balance < 0)
    .sort((a, b) => a.balance - b.balance);
  const mine = balances.balances.find((b) => b.participantId === currentId);
  const allSettled = toReceive.length === 0 && toPay.length === 0;

  return (
    <Card className="mt-6">
      {mine ? (
        <div className="mb-4 border-b border-slate-100 pb-4">
          <p className="text-xs font-bold tracking-wider text-slate-500 uppercase">Ton solde</p>
          <p
            className={`tabular mt-1 text-4xl font-bold ${
              mine.balance > 0
                ? 'text-emerald-700'
                : mine.balance < 0
                  ? 'text-red-700'
                  : 'text-slate-700'
            }`}
            data-testid="my-balance"
          >
            {money(mine.balance, true)}
          </p>
          <p className="text-sm text-slate-500">
            {mine.balance > 0 ? 'à recevoir' : mine.balance < 0 ? 'à payer' : 'à l’équilibre'}
          </p>
        </div>
      ) : null}

      {allSettled ? (
        <p className="text-center text-slate-600">Tout le monde est à l’équilibre. ⚖️</p>
      ) : (
        <div className="space-y-4">
          <BalanceList
            title="À recevoir"
            tone="positive"
            entries={toReceive}
            name={name}
            money={money}
          />
          <BalanceList title="À payer" tone="negative" entries={toPay} name={name} money={money} />
        </div>
      )}

      {balances.nextPayerId ? (
        <p className="mt-4 rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800">
          Qui paie la prochaine ? → <strong>{name(balances.nextPayerId)}</strong>
        </p>
      ) : null}

      {balances.pending.count > 0 ? (
        <p className="mt-3 text-sm text-amber-700">
          ⏳ {balances.pending.count} opération{balances.pending.count > 1 ? 's' : ''} en attente (
          {money(balances.pending.amount)}), pas encore comptée
          {balances.pending.count > 1 ? 's' : ''} dans les soldes.
        </p>
      ) : null}

      {balances.settlementSuggestions.length > 0 ? (
        <details className="mt-4 text-sm" open={state === 'SETTLEMENT'}>
          <summary className="cursor-pointer font-semibold text-brand-700">
            Comment tout solder ? ({balances.settlementSuggestions.length} virement
            {balances.settlementSuggestions.length > 1 ? 's' : ''})
          </summary>
          <ul className="mt-2 space-y-1">
            {balances.settlementSuggestions.map((t) => {
              const label = (
                <>
                  <span className="min-w-0 truncate">
                    {name(t.from)} → {name(t.to)}
                  </span>
                  <span className="tabular font-semibold">{money(t.amount)}</span>
                </>
              );
              // Un participant désactivé ne peut plus être payeur ni bénéficiaire : pas de lien.
              const recordable =
                reimbursementPath !== null &&
                Boolean(byId.get(t.from)?.isActive) &&
                Boolean(byId.get(t.to)?.isActive);
              return (
                <li key={`${t.from}-${t.to}`}>
                  {recordable ? (
                    <Link
                      to={`${reimbursementPath}?from=${t.from}&to=${t.to}&amount=${String(t.amount)}`}
                      aria-label={`Enregistrer le remboursement de ${name(t.from)} à ${name(t.to)}`}
                      className="-mx-2 flex min-h-10 items-center justify-between gap-2 rounded-lg px-2 hover:bg-brand-50"
                    >
                      {label}
                      <span className="text-brand-700" aria-hidden="true">
                        ›
                      </span>
                    </Link>
                  ) : (
                    <div className="flex min-h-10 items-center justify-between gap-2">{label}</div>
                  )}
                </li>
              );
            })}
          </ul>
          {reimbursementPath !== null ? (
            <p className="mt-2 text-xs text-slate-500">
              Touchez un virement pour l’enregistrer une fois effectué.
            </p>
          ) : null}
        </details>
      ) : null}
    </Card>
  );
}

function BalanceList({
  title,
  tone,
  entries,
  name,
  money,
}: {
  title: string;
  tone: 'positive' | 'negative';
  entries: { participantId: string; balance: number }[];
  name: (id: string) => string;
  money: (amount: number, signed?: boolean) => string;
}) {
  if (entries.length === 0) return null;
  return (
    <section aria-label={title}>
      <h3 className="text-xs font-bold tracking-wider text-slate-500 uppercase">{title}</h3>
      <ul className="mt-1">
        {entries.map((entry) => (
          <li key={entry.participantId} className="flex justify-between gap-2 py-0.5">
            <span className="min-w-0 truncate">{name(entry.participantId)}</span>
            <span
              className={`tabular font-semibold ${tone === 'positive' ? 'text-emerald-700' : 'text-red-700'}`}
            >
              {money(entry.balance, true)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
