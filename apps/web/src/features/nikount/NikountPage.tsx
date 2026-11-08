import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { tokenRole, type AccessRole, type MeResponse } from '@nikount/contracts';
import { ApiError } from '../../api/client';
import { useMe, useParticipantLink } from '../../api/nikount';
import { Card, PageShell, ShareableLink, StateBadge } from '../../components/ui';
import { nikountUrl } from '../../lib/links';
import { forgetNikount, rememberNikount } from '../../lib/recent-nikounts';

/**
 * Accueil d'un nikount, pour `/n/:token` (participant) et `/a/:token` (admin).
 * Le rôle affiché est celui renvoyé par l'API ; le préfixe de l'URL ne sert qu'à rejeter tôt
 * un lien manifestement invalide.
 */
export function NikountPage({ expectedRole }: { expectedRole: AccessRole }) {
  const { token = '' } = useParams();
  const wellFormed = tokenRole(token) === expectedRole;
  return wellFormed ? <NikountLoader token={token} /> : <InvalidLink />;
}

function NikountLoader({ token }: { token: string }) {
  const me = useMe(token);

  useEffect(() => {
    if (me.data) rememberNikount({ token, role: me.data.role, name: me.data.nikount.name });
  }, [me.data, token]);

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) forgetNikount(token);
  }, [me.error, token]);

  if (me.isPending) {
    return (
      <PageShell>
        <p className="m-auto text-slate-500" role="status">
          Chargement…
        </p>
      </PageShell>
    );
  }

  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) return <InvalidLink />;
    if (me.error instanceof ApiError && me.error.status === 429) {
      return (
        <ErrorScreen message="Trop de tentatives depuis cette connexion. Réessayez dans quelques minutes." />
      );
    }
    return <ErrorScreen message="Impossible de charger ce nikount. Vérifiez votre connexion." />;
  }

  return <NikountHome token={token} me={me.data} />;
}

function NikountHome({ token, me }: { token: string; me: MeResponse }) {
  const isAdmin = me.role === 'ADMIN';
  const participantLink = useParticipantLink(token, isAdmin);

  return (
    <PageShell>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-brand-700">nikount</p>
          <h1 className="mt-1 truncate text-2xl font-bold">{me.nikount.name}</h1>
        </div>
        <StateBadge state={me.nikount.state} />
      </header>
      {me.admin ? (
        <p className="mt-1 text-sm text-slate-500">Administrateur · {me.admin.label}</p>
      ) : null}

      <Card className="mt-6 text-center">
        <p className="text-4xl" aria-hidden="true">
          🧾
        </p>
        <h2 className="mt-2 font-bold">Aucune dépense pour l’instant</h2>
        <p className="mt-1 text-sm text-slate-600">
          Les participants, les dépenses et les soldes arrivent dans les prochaines versions.
        </p>
      </Card>

      {isAdmin ? (
        <Card className="mt-4">
          <h2 className="font-bold">👥 Inviter le groupe</h2>
          <p className="mt-1 mb-3 text-sm text-slate-600">
            Envoyez ce lien aux participants. Ne partagez jamais votre lien administrateur.
          </p>
          {participantLink.data ? (
            <ShareableLink
              label="Lien du groupe"
              url={nikountUrl('PARTICIPANT', participantLink.data.participantToken)}
              shareTitle={me.nikount.name}
            />
          ) : participantLink.isError ? (
            <p className="text-sm text-red-600">Lien indisponible pour le moment.</p>
          ) : (
            <p className="text-sm text-slate-500">Chargement du lien…</p>
          )}
        </Card>
      ) : null}

      <Link to="/" className="mt-auto pt-8 text-center text-sm font-semibold text-brand-700">
        Mes nikounts
      </Link>
    </PageShell>
  );
}

function InvalidLink() {
  return (
    <ErrorScreen
      title="Lien invalide"
      message="Ce lien n’existe pas ou n’est plus actif. Demandez un nouveau lien à l’organisateur."
    />
  );
}

function ErrorScreen({ title = 'Oups', message }: { title?: string; message: string }) {
  return (
    <PageShell>
      <div className="m-auto space-y-4 text-center">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-slate-600">{message}</p>
        <Link
          to="/"
          className="inline-block font-semibold text-brand-700 underline underline-offset-4"
        >
          Retour à l’accueil
        </Link>
      </div>
    </PageShell>
  );
}
