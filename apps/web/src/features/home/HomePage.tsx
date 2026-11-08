import { useQuery } from '@tanstack/react-query';
import { HealthResponse } from '@nikount/contracts';
import { apiRequest } from '../../api/client';

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

export function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
      <header className="flex items-center gap-3">
        <img src="/icon.svg" alt="" className="size-10" />
        <span className="text-2xl font-bold tracking-tight text-brand-700">nikount</span>
      </header>

      <section className="mt-12 flex-1">
        <h1 className="text-3xl font-bold leading-tight">
          Les dépenses du groupe, sans compte ni appli à installer.
        </h1>
        <p className="mt-4 text-lg text-slate-600">
          Un week-end, des vacances, une sortie club : partagez un lien, chacun ajoute ses dépenses,
          nikount calcule qui doit quoi.
        </p>
      </section>

      <div className="space-y-4">
        <button
          type="button"
          disabled
          className="w-full rounded-2xl bg-brand-700 px-6 py-4 text-lg font-semibold text-white shadow-sm disabled:opacity-60"
        >
          Créer un nikount
          <span className="block text-sm font-normal">Bientôt disponible</span>
        </button>
        <ServiceStatus />
      </div>
    </main>
  );
}
