import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import type { MeResponse } from '@nikount/contracts';
import { useBalances } from '../../api/balances';
import { StateBadge } from '../../components/ui';

/**
 * Cadre d'un écran du nikount.
 * - Mobile (docs/product.md §15) : navigation basse Accueil · Dépenses · Remboursements · Menu ;
 *   « Dépenses » et « Remboursements » sont l'historique filtré par type.
 * - Admin à partir de `lg` (D T5) : barre latérale fixe à la place de la navigation basse.
 *   C'est le même SPA et les mêmes écrans : seul le cadre change.
 */
export function NikountLayout({
  token,
  me,
  basePath,
  mobileNav = true,
  children,
}: {
  token: string;
  me: MeResponse;
  basePath: string;
  /** Navigation basse sur mobile (masquée sur les écrans de gestion, qui ont leur lien retour). */
  mobileNav?: boolean;
  children: ReactNode;
}) {
  const isAdmin = me.role === 'ADMIN';
  return (
    <>
      {isAdmin ? <AdminSidebar token={token} me={me} basePath={basePath} /> : null}
      <div className={`${mobileNav ? 'pb-20' : ''} ${isAdmin ? 'lg:pb-0 lg:pl-64' : ''}`}>
        {children}
      </div>
      {mobileNav ? <BottomNav basePath={basePath} hideOnDesktop={isAdmin} /> : null}
    </>
  );
}

function useCurrentPath() {
  const location = useLocation();
  return {
    path: location.pathname.replace(/\/+$/, ''),
    filter: new URLSearchParams(location.search).get('filter'),
  };
}

function BottomNav({ basePath, hideOnDesktop }: { basePath: string; hideOnDesktop: boolean }) {
  const { path, filter } = useCurrentPath();
  const tabs = [
    { label: 'Accueil', icon: '🏠', to: basePath, active: path === basePath },
    {
      label: 'Dépenses',
      icon: '🧾',
      to: `${basePath}/history?filter=EXPENSE`,
      active: path === `${basePath}/history` && filter === 'EXPENSE',
    },
    {
      label: 'Remboursements',
      icon: '💸',
      to: `${basePath}/history?filter=REIMBURSEMENT`,
      active: path === `${basePath}/history` && filter === 'REIMBURSEMENT',
    },
    { label: 'Menu', icon: '☰', to: `${basePath}/menu`, active: path === `${basePath}/menu` },
  ];

  return (
    <nav
      aria-label="Navigation du nikount"
      className={`fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur ${hideOnDesktop ? 'lg:hidden' : ''}`}
    >
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {tabs.map((tab) => (
          <li key={tab.label}>
            <Link
              to={tab.to}
              aria-current={tab.active ? 'page' : undefined}
              className="flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-semibold text-slate-500 aria-[current=page]:text-brand-700"
            >
              <span className="text-xl" aria-hidden="true">
                {tab.icon}
              </span>
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function AdminSidebar({
  token,
  me,
  basePath,
}: {
  token: string;
  me: MeResponse;
  basePath: string;
}) {
  const { path } = useCurrentPath();
  const pending = useBalances(token).data?.pending.count ?? 0;
  const links = [
    { label: 'Tableau de bord', icon: '🏠', to: basePath },
    { label: 'À valider', icon: '⏳', to: `${basePath}/review`, badge: pending },
    { label: 'Opérations', icon: '📋', to: `${basePath}/operations` },
    { label: 'Historique', icon: '🧾', to: `${basePath}/history` },
    { label: 'Participants', icon: '👥', to: `${basePath}/participants` },
    { label: 'Gestion', icon: '⚙️', to: `${basePath}/settings` },
    { label: 'Journal', icon: '🕓', to: `${basePath}/audit` },
  ];

  return (
    <nav
      aria-label="Administration"
      className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-slate-200 bg-white px-4 py-6 lg:flex"
    >
      <div className="px-2">
        <p className="truncate text-lg font-bold" title={me.nikount.name}>
          {me.nikount.name}
        </p>
        <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
          <StateBadge state={me.nikount.state} />
          <span>Admin · {me.admin?.label}</span>
        </div>
      </div>
      <ul className="mt-6 space-y-1">
        {links.map((link) => {
          const active =
            path === link.to || (link.to !== basePath && path.startsWith(`${link.to}/`));
          return (
            <li key={link.to}>
              <Link
                to={link.to}
                aria-current={active ? 'page' : undefined}
                className="flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 aria-[current=page]:bg-brand-50 aria-[current=page]:text-brand-800"
              >
                <span aria-hidden="true">{link.icon}</span>
                <span className="flex-1">{link.label}</span>
                {link.badge ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                    {link.badge}
                    <span className="sr-only"> en attente</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto space-y-2 px-2">
        <Link
          to={`${basePath}/expenses/new`}
          className="flex min-h-11 items-center justify-center rounded-xl bg-brand-700 text-sm font-semibold text-white hover:bg-brand-800"
        >
          + Dépense
        </Link>
        <Link
          to={`${basePath}/reimbursements/new`}
          className="flex min-h-11 items-center justify-center rounded-xl text-sm font-semibold text-brand-800 ring-1 ring-brand-700/30 hover:bg-brand-50"
        >
          💸 Remboursement
        </Link>
      </div>
    </nav>
  );
}
