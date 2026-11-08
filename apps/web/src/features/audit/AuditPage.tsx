import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { MeResponse } from '@nikount/contracts';
import { useAudit } from '../../api/audit';
import { useParticipants } from '../../api/participants';
import { useTransactions } from '../../api/transactions';
import { Button } from '../../components/ui';
import { AUDIT_FAMILIES, auditActor, describeAuditEvent } from '../../lib/audit';
import { formatDateTime } from '../../lib/dates';

/**
 * Journal d'audit (admin) : qui a fait quoi, quand. Lecture seule ; filtrable par famille
 * d'actions, chargé page par page du plus récent au plus ancien.
 */
export function AuditPage({
  token,
  me,
  basePath,
}: {
  token: string;
  me: MeResponse;
  basePath: string;
}) {
  const [family, setFamily] = useState<string | null>(null);
  const audit = useAudit(token, family);
  const participants = useParticipants(token);
  const transactions = useTransactions(token);
  const ctx = useMemo(
    () => ({
      currency: me.nikount.currency,
      names: new Map((participants.data ?? []).map((p) => [p.id, p.name])),
      descriptions: new Map((transactions.data ?? []).map((t) => [t.id, t.description])),
    }),
    [me.nikount.currency, participants.data, transactions.data],
  );
  const events = audit.data?.pages.flatMap((page) => page.events) ?? [];

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-6 lg:px-8">
      <Link to={`${basePath}/menu`} className="text-sm font-semibold text-brand-700 lg:hidden">
        ← Menu
      </Link>
      <h1 className="mt-2 text-2xl font-bold lg:mt-0">Journal</h1>
      <p className="mt-1 text-sm text-slate-600">
        Toutes les actions sur ce nikount, de la plus récente à la plus ancienne. Rien ne peut y
        être effacé.
      </p>

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filtrer le journal">
        {AUDIT_FAMILIES.map((f) => (
          <button
            key={f.label}
            type="button"
            aria-pressed={family === f.value}
            onClick={() => {
              setFamily(f.value);
            }}
            className="rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 aria-pressed:bg-brand-700 aria-pressed:text-white aria-pressed:ring-brand-700"
          >
            {f.label}
          </button>
        ))}
      </div>

      {audit.isPending ? (
        <p className="mt-10 text-center text-slate-500" role="status">
          Chargement…
        </p>
      ) : audit.isError && events.length === 0 ? (
        <p className="mt-10 text-center text-slate-600">Impossible de charger le journal.</p>
      ) : events.length === 0 ? (
        <p className="mt-10 text-center text-slate-500">Aucun événement.</p>
      ) : (
        <ol className="mt-4 divide-y divide-slate-100 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          {events.map((event) => (
            <li key={event.id} className="px-4 py-3">
              <p>
                <strong>{auditActor(event, ctx.names)}</strong> {describeAuditEvent(event, ctx)}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                <time dateTime={event.occurredAt}>
                  {formatDateTime(event.occurredAt, me.nikount.timezone)}
                </time>
                {event.entityType === 'transaction' &&
                event.entityId &&
                ctx.descriptions.has(event.entityId) ? (
                  <>
                    {' · '}
                    <Link
                      to={`${basePath}/tx/${event.entityId}`}
                      className="font-semibold text-brand-700"
                    >
                      Voir l’opération
                    </Link>
                  </>
                ) : null}
              </p>
            </li>
          ))}
        </ol>
      )}

      {audit.hasNextPage ? (
        <div className="mt-4 text-center">
          <Button
            variant="secondary"
            disabled={audit.isFetchingNextPage}
            onClick={() => {
              void audit.fetchNextPage();
            }}
          >
            {audit.isFetchingNextPage ? 'Chargement…' : 'Plus ancien'}
          </Button>
        </div>
      ) : null}
    </main>
  );
}
