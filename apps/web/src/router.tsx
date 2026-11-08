import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter } from 'react-router';
import { HomePage } from './features/home/HomePage';
import { NotFoundPage } from './features/system/NotFoundPage';

// Un écran par fichier JS : l'accueil reste léger, un lien de nikount ne charge pas la création.
const NewNikountPage = lazy(() =>
  import('./features/create/NewNikountPage').then((m) => ({ default: m.NewNikountPage })),
);
const NikountPage = lazy(() =>
  import('./features/nikount/NikountPage').then((m) => ({ default: m.NikountPage })),
);

/** Rien à afficher pendant le chargement d'un écran (quelques dizaines de ms). */
const deferred = (page: ReactNode) => <Suspense fallback={null}>{page}</Suspense>;

/** Routes de l'application (docs/architecture.md §5). */
export const routes = [
  { path: '/', element: <HomePage /> },
  { path: '/new', element: deferred(<NewNikountPage />) },
  { path: '/n/:token/*', element: deferred(<NikountPage expectedRole="PARTICIPANT" />) },
  { path: '/a/:token/*', element: deferred(<NikountPage expectedRole="ADMIN" />) },
  { path: '*', element: <NotFoundPage /> },
];

export const router = createBrowserRouter(routes);
