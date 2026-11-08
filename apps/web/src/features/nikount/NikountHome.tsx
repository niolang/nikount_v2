import { Link, useLocation } from 'react-router';
import type { MeResponse, ParticipantView, TransactionView } from '@nikount/contracts';
import { isActionAllowed } from '@nikount/core';
import { useParticipantLink } from '../../api/nikount';
import { useParticipants } from '../../api/participants';
import { useTransactions } from '../../api/transactions';
import { useBalances } from '../../api/balances';
import { BalancesCard } from '../balances/BalancesCard';
import { Card, PageShell, ShareableLink, StateBadge } from '../../components/ui';
import { transactionEmoji } from '../../lib/categories';
import { formatShortDate } from '../../lib/dates';
import { formatMoney } from '../../lib/format';
import { nikountUrl } from '../../lib/links';
import { useCurrentParticipant } from './useCurrentParticipant';

/** Nombre d'opérations affichées sur l'accueil (l'historique complet arrive en Phase 6). */
const RECENT_LIMIT = 10;

export function NikountHome({ token, me }: { token: string; me: MeResponse }) {
  const participants = useParticipants(token);
  const transactions = useTransactions(token);
  const balances = useBalances(token);
  const identity = useCurrentParticipant(token, me, participants.data ?? []);
  const isAdmin = me.role === 'ADMIN';
  const needsIdentity = !isAdmin && participants.isSuccess && identity.current === null;
  const canAddExpense =
    isActionAllowed('CREATE_EXPENSE', me.nikount.state) &&
    (participants.data ?? []).some((p) => p.isActive);
  const flash = (useLocation().state as { flash?: string } | null)?.flash;

  return (
    <PageShell>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-wider text-brand-700 uppercase">nikount</p>
          <h1 className="mt-1 truncate text-2xl font-bold">{me.nikount.name}</h1>
        </div>
        <StateBadge state={me.nikount.state} />
      </header>
      <p className="mt-1 text-sm text-slate-500">
        {isAdmin && me.admin ? `Administrateur · ${me.admin.label}` : null}
        {!isAdmin && identity.current ? (
          <>
            Vous êtes <strong className="text-slate-700">{identity.current.name}</strong> ·{' '}
            <button
              type="button"
              className="font-semibold text-brand-700 underline underline-offset-2"
              onClick={identity.reset}
            >
              changer
            </button>
          </>
        ) : null}
      </p>

      {participants.isError ? (
        <p role="alert" className="mt-6 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          Impossible de charger les participants. Vérifiez votre connexion.
        </p>
      ) : null}

      {needsIdentity ? (
        <IdentityPicker participants={participants.data} onPick={identity.declare} />
      ) : (
        <>
          {flash ? (
            <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
              {flash}
            </p>
          ) : null}

          {balances.data && participants.data ? (
            <BalancesCard
              balances={balances.data}
              participants={participants.data}
              currentId={identity.current?.id ?? null}
              currency={me.nikount.currency}
              state={me.nikount.state}
            />
          ) : balances.isError ? (
            <p role="alert" className="mt-6 rounded-xl bg-red-50 p-3 text-sm text-red-700">
              Impossible de charger les soldes.
            </p>
          ) : null}

          {canAddExpense ? (
            <Link
              to="expenses/new"
              className="mt-6 flex min-h-14 items-center justify-center rounded-2xl bg-brand-700 px-6 text-lg font-semibold text-white shadow-sm hover:bg-brand-800"
            >
              + Ajouter une dépense
            </Link>
          ) : null}

          <RecentTransactions
            transactions={transactions.data}
            isError={transactions.isError}
            participants={participants.data ?? []}
            currency={me.nikount.currency}
          />

          {participants.data ? (
            <ParticipantsCard
              participants={participants.data}
              currentId={identity.current?.id ?? null}
              manageLink={isAdmin ? 'participants' : null}
            />
          ) : null}

          {isAdmin ? <InviteCard token={token} nikountName={me.nikount.name} /> : null}
        </>
      )}

      <Link to="/" className="mt-auto pt-8 text-center text-sm font-semibold text-brand-700">
        Mes nikounts
      </Link>
    </PageShell>
  );
}

/** Premier accès d'un participant : « Qui êtes-vous ? ». Purement déclaratif. */
function IdentityPicker({
  participants,
  onPick,
}: {
  participants: ParticipantView[];
  onPick: (participantId: string) => void;
}) {
  const active = participants.filter((p) => p.isActive);
  return (
    <Card className="mt-6">
      <h2 className="text-lg font-bold">Qui êtes-vous ?</h2>
      {active.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">
          L’organisateur n’a encore ajouté personne. Revenez un peu plus tard.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-600">
            Choisissez votre nom : il sera mémorisé sur cet appareil.
          </p>
          <ul className="mt-4 grid grid-cols-2 gap-2">
            {active.map((participant) => (
              <li key={participant.id}>
                <button
                  type="button"
                  className="min-h-12 w-full truncate rounded-xl bg-brand-50 px-3 py-2 font-semibold text-brand-800 ring-1 ring-brand-700/20 hover:bg-brand-100"
                  onClick={() => {
                    onPick(participant.id);
                  }}
                >
                  {participant.name}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-slate-500">
            Vous n’êtes pas dans la liste ? Demandez à l’organisateur de vous ajouter.
          </p>
        </>
      )}
    </Card>
  );
}

function ParticipantsCard({
  participants,
  currentId,
  manageLink,
}: {
  participants: ParticipantView[];
  currentId: string | null;
  manageLink: string | null;
}) {
  const active = participants.filter((p) => p.isActive);
  return (
    <Card className="mt-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">Participants ({active.length})</h2>
        {manageLink ? (
          <Link to={manageLink} className="text-sm font-semibold text-brand-700">
            Gérer
          </Link>
        ) : null}
      </div>
      {active.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">Personne pour l’instant.</p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {active.map((participant) => (
            <li
              key={participant.id}
              className={`rounded-full px-3 py-1 text-sm ${
                participant.id === currentId
                  ? 'bg-brand-700 font-semibold text-white'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              {participant.name}
              {participant.id === currentId ? ' (vous)' : ''}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function InviteCard({ token, nikountName }: { token: string; nikountName: string }) {
  const participantLink = useParticipantLink(token, true);
  return (
    <Card className="mt-4">
      <h2 className="font-bold">👥 Inviter le groupe</h2>
      <p className="mt-1 mb-3 text-sm text-slate-600">
        Envoyez ce lien aux participants. Ne partagez jamais votre lien administrateur.
      </p>
      {participantLink.data ? (
        <ShareableLink
          label="Lien du groupe"
          url={nikountUrl('PARTICIPANT', participantLink.data.participantToken)}
          shareTitle={nikountName}
        />
      ) : participantLink.isError ? (
        <p className="text-sm text-red-600">Lien indisponible pour le moment.</p>
      ) : (
        <p className="text-sm text-slate-500">Chargement du lien…</p>
      )}
    </Card>
  );
}

/** Dernières opérations (version simple ; l'historique complet arrive en Phase 6). */
function RecentTransactions({
  transactions,
  isError,
  participants,
  currency,
}: {
  transactions: TransactionView[] | undefined;
  isError: boolean;
  participants: ParticipantView[];
  currency: string;
}) {
  const names = new Map(participants.map((p) => [p.id, p.name]));
  return (
    <Card className="mt-4">
      <h2 className="font-bold">Dernières opérations</h2>
      {isError ? (
        <p className="mt-2 text-sm text-red-600">Impossible de charger les opérations.</p>
      ) : !transactions ? (
        <p className="mt-2 text-sm text-slate-500">Chargement…</p>
      ) : transactions.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">Aucune dépense pour l’instant.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {transactions.slice(0, RECENT_LIMIT).map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2.5">
              <span className="text-2xl" aria-hidden="true">
                {transactionEmoji(t.type, t.category)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{t.description}</p>
                <p className="text-sm text-slate-500">
                  {names.get(t.payerId) ?? '?'} · {formatShortDate(t.occurredOn)}
                </p>
              </div>
              <div className="text-right">
                <p className="tabular font-semibold">{formatMoney(t.amount, currency)}</p>
                {t.status === 'PENDING' ? (
                  <p className="text-xs font-semibold text-amber-700">⏳ En attente</p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
