import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';

/**
 * Navigation basse mobile (docs/product.md §15) : Accueil · Dépenses · Remboursements · Menu.
 * « Dépenses » et « Remboursements » sont l'historique filtré par type.
 */
export function NikountLayout({ basePath, children }: { basePath: string; children: ReactNode }) {
  const location = useLocation();
  const filter = new URLSearchParams(location.search).get('filter');
  const path = location.pathname.replace(/\/+$/, '');

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
    <>
      <div className="pb-20">{children}</div>
      <nav
        aria-label="Navigation du nikount"
        className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
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
    </>
  );
}
