import { useEffect, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useParams } from 'react-router';
import { tokenRole, type AccessRole, type MeResponse } from '@nikount/contracts';
import { ApiError } from '../../api/client';
import { useMe } from '../../api/nikount';
import { PageShell } from '../../components/ui';
import { nikountPath } from '../../lib/links';
import { forgetNikount, rememberNikount } from '../../lib/recent-nikounts';
import { ReviewPage } from '../review/ReviewPage';
import { ExpenseFormPage } from '../transactions/ExpenseFormPage';
import { HistoryPage } from '../transactions/HistoryPage';
import { ReimbursementFormPage } from '../transactions/ReimbursementFormPage';
import { TransactionDetailPage } from '../transactions/TransactionDetailPage';
import { ManageParticipantsPage } from './ManageParticipantsPage';
import { MenuPage } from './MenuPage';
import { NikountHome } from './NikountHome';
import { NikountLayout } from './NikountLayout';

/**
 * Point d'entrée d'un nikount, pour `/n/:token/*` (participant) et `/a/:token/*` (admin).
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

  return <NikountRoutes token={token} me={me.data} />;
}

function NikountRoutes({ token, me }: { token: string; me: MeResponse }) {
  // Chemins absolus : les liens fonctionnent depuis n'importe quel écran du nikount.
  const basePath = nikountPath(me.role, token);
  const props = { token, me, basePath };
  const withNav = (page: ReactNode) => <NikountLayout basePath={basePath}>{page}</NikountLayout>;

  return (
    <Routes>
      <Route index element={withNav(<NikountHome {...props} />)} />
      <Route path="history" element={withNav(<HistoryPage {...props} />)} />
      <Route path="menu" element={withNav(<MenuPage {...props} />)} />
      <Route path="tx/:transactionId" element={withNav(<TransactionDetailPage {...props} />)} />
      <Route path="expenses/new" element={<ExpenseFormPage token={token} me={me} />} />
      <Route path="reimbursements/new" element={<ReimbursementFormPage token={token} me={me} />} />
      <Route
        path="review"
        element={
          me.role === 'ADMIN' ? (
            withNav(<ReviewPage {...props} />)
          ) : (
            <Navigate to={basePath} replace />
          )
        }
      />
      <Route
        path="participants"
        element={
          me.role === 'ADMIN' ? (
            <ManageParticipantsPage token={token} me={me} />
          ) : (
            <Navigate to={basePath} replace />
          )
        }
      />
      <Route path="*" element={<Navigate to={basePath} replace />} />
    </Routes>
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
