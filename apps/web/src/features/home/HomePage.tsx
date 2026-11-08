import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { HealthResponse } from '@nikount/contracts';
import { apiRequest } from '../../api/client';
import { PageShell } from '../../components/ui';
import { nikountPath } from '../../lib/links';
import { forgetNikount, loadRecentNikounts, type RecentNikount } from '../../lib/recent-nikounts';

function useApiHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) =>
      apiRequest({ path: '/health', schema: HealthResponse, acceptStatuses: [503], signal }),
    retry: false,
  });
}

function ServiceStatus() {
  const health = useApiHealth();

  const label = health.isPending
    ? 'Vérification du service…'
    : health.data?.status === 'ok'
      ? 'Service opérationnel'
      : 'Service indisponible';
  const color = health.isPending
    ? 'bg-slate-300'
    : health.data?.status === 'ok'
      ? 'bg-emerald-500'
      : 'bg-red-500';

  return (
    <p className="flex items-center justify-center gap-2 text-sm text-slate-500" role="status">
      <span className={`inline-block size-2 rounded-full ${color}`} aria-hidden="true" />
      {label}
    </p>
  );
}

function RecentList() {
  const [recent, setRecent] = useState<RecentNikount[]>(loadRecentNikounts);
  if (recent.length === 0) return null;

  return (
    <section className="mt-10" aria-labelledby="recent-title">
      <h2 id="recent-title" className="text-sm font-bold uppercase tracking-wider text-slate-500">
        Mes nikounts
      </h2>
      <ul className="mt-3 divide-y divide-slate-200 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        {recent.map((entry) => (
          <li key={entry.token} className="flex items-center">
            <Link
              to={nikountPath(entry.role, entry.token)}
              className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-3 hover:bg-slate-50"
            >
              <span className="truncate font-semibold">{entry.name}</span>
              {entry.role === 'ADMIN' ? (
                <span className="shrink-0 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-800">
                  Admin
                </span>
              ) : null}
            </Link>
            <button
              type="button"
              aria-label={`Oublier ${entry.name} sur cet appareil`}
              className="min-h-14 px-4 text-slate-400 hover:text-slate-700"
              onClick={() => {
                forgetNikount(entry.token);
                setRecent(loadRecentNikounts());
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HomePage() {
  return (
    <PageShell>
      <header className="flex items-center gap-3">
        <img src="/icon.svg" alt="" className="size-10" />
        <span className="text-2xl font-bold tracking-tight text-brand-700">nikount</span>
      </header>

      <section className="mt-12">
        <h1 className="text-3xl font-bold leading-tight">
          Les dépenses du groupe, sans compte ni appli à installer.
        </h1>
        <p className="mt-4 text-lg text-slate-600">
          Un week-end, des vacances, une sortie club : partagez un lien, chacun ajoute ses dépenses,
          nikount calcule qui doit quoi.
        </p>
      </section>

      <RecentList />

      <div className="mt-auto space-y-4 pt-10">
        <Link
          to="/new"
          className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-brand-700 px-6 py-4 text-lg font-semibold text-white shadow-sm hover:bg-brand-800"
        >
          Créer un nikount
        </Link>
        <ServiceStatus />
      </div>
    </PageShell>
  );
}
