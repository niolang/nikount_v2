import { Link, useNavigate } from 'react-router';
import type { MeResponse, ParticipantView } from '@nikount/contracts';
import { useParticipantLink } from '../../api/nikount';
import { useParticipants } from '../../api/participants';
import { Button, Card, PageShell, ShareableLink } from '../../components/ui';
import { nikountUrl } from '../../lib/links';
import { NikountHeader } from './NikountHome';
import { useCurrentParticipant } from './useCurrentParticipant';

/** Menu : identité, participants, invitation (admin), gestion (admin), autres nikounts. */
export function MenuPage({
  token,
  me,
  basePath,
}: {
  token: string;
  me: MeResponse;
  basePath: string;
}) {
  const participants = useParticipants(token);
  const identity = useCurrentParticipant(token, me, participants.data ?? []);
  const navigate = useNavigate();
  const isAdmin = me.role === 'ADMIN';

  return (
    <PageShell>
      <NikountHeader me={me} />

      <Card className="mt-6">
        <h2 className="font-bold">Vous</h2>
        {isAdmin ? (
          <p className="mt-1 text-sm text-slate-600">
            Administrateur · {me.admin?.label}
            {identity.current ? ` (participant : ${identity.current.name})` : ' (ne participe pas)'}
          </p>
        ) : identity.current ? (
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="text-sm text-slate-600">
              Vous êtes <strong className="text-slate-800">{identity.current.name}</strong> sur cet
              appareil.
            </p>
            <Button
              variant="ghost"
              className="min-h-10 px-3 text-sm"
              onClick={() => {
                identity.reset();
                void navigate(basePath);
              }}
            >
              Changer
            </Button>
          </div>
        ) : (
          <p className="mt-1 text-sm text-slate-600">Identité non choisie.</p>
        )}
      </Card>

      {participants.data ? (
        <ParticipantsCard
          participants={participants.data}
          currentId={identity.current?.id ?? null}
          manageLink={isAdmin ? `${basePath}/participants` : null}
        />
      ) : null}

      {isAdmin ? (
        <InviteCard
          token={token}
          nikountName={me.nikount.name}
          settingsPath={`${basePath}/settings`}
        />
      ) : null}

      {isAdmin ? (
        <Link
          to={`${basePath}/settings`}
          className="mt-4 flex items-center justify-between rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
        >
          <span>
            <span className="block font-bold">⚙️ Gestion du nikount</span>
            <span className="mt-1 block text-sm text-slate-600">
              Terminer, clôturer, renommer, administrateurs
            </span>
          </span>
          <span aria-hidden="true" className="text-xl text-slate-400">
            ›
          </span>
        </Link>
      ) : null}

      <Link to="/" className="mt-6 text-center text-sm font-semibold text-brand-700">
        Mes nikounts
      </Link>
    </PageShell>
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

function InviteCard({
  token,
  nikountName,
  settingsPath,
}: {
  token: string;
  nikountName: string;
  settingsPath: string;
}) {
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
      <Link to={settingsPath} className="mt-3 inline-block text-sm font-semibold text-brand-700">
        Le lien a trop circulé ? Le changer
      </Link>
    </Card>
  );
}
