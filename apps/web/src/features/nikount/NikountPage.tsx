import { useEffect, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useParams } from 'react-router';
import { tokenRole, type AccessRole, type MeResponse } from '@nikount/contracts';
import { ApiError } from '../../api/client';
import { useMe } from '../../api/nikount';
import { PageShell } from '../../components/ui';
import { nikountPath } from '../../lib/links';
import { forgetNikount, rememberNikount } from '../../lib/recent-nikounts';
import { AuditPage } from '../audit/AuditPage';
import { OperationsPage } from '../operations/OperationsPage';
import { ReviewPage } from '../review/ReviewPage';
import { EditTransactionPage } from '../transactions/EditTransaction';
import { ExpenseFormPage } from '../transactions/ExpenseFormPage';
import { HistoryPage } from '../transactions/HistoryPage';
import { ReimbursementFormPage } from '../transactions/ReimbursementFormPage';
import { TransactionDetailPage } from '../transactions/TransactionDetailPage';
import { ManageParticipantsPage } from './ManageParticipantsPage';
import { MenuPage } from './MenuPage';
import { NikountHome } from './NikountHome';
import { NikountLayout } from './NikountLayout';
import { SettingsPage } from './SettingsPage';

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
  const layout = (page: ReactNode, mobileNav = true) => (
    <NikountLayout token={token} me={me} basePath={basePath} mobileNav={mobileNav}>
      {page}
    </NikountLayout>
  );
  // Écrans de gestion : réservés aux admins (le serveur le vérifie aussi), sans navigation basse.
  const adminOnly = (page: ReactNode, mobileNav = false) =>
    me.role === 'ADMIN' ? layout(page, mobileNav) : <Navigate to={basePath} replace />;

  return (
    <Routes>
      <Route index element={layout(<NikountHome {...props} />)} />
      <Route path="history" element={layout(<HistoryPage {...props} />)} />
      <Route path="menu" element={layout(<MenuPage {...props} />)} />
      <Route path="tx/:transactionId" element={layout(<TransactionDetailPage {...props} />)} />
      <Route
        path="tx/:transactionId/edit"
        element={adminOnly(<EditTransactionPage {...props} />)}
      />
      <Route
        path="expenses/new"
        element={layout(<ExpenseFormPage token={token} me={me} />, false)}
      />
      <Route
        path="reimbursements/new"
        element={layout(<ReimbursementFormPage token={token} me={me} />, false)}
      />
      <Route path="review" element={adminOnly(<ReviewPage {...props} />, true)} />
      <Route path="operations" element={adminOnly(<OperationsPage {...props} />)} />
      <Route path="audit" element={adminOnly(<AuditPage {...props} />)} />
      <Route
        path="participants"
        element={adminOnly(<ManageParticipantsPage token={token} me={me} />)}
      />
      <Route path="settings" element={adminOnly(<SettingsPage {...props} />)} />
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
