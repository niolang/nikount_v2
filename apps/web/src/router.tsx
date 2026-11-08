import { createBrowserRouter } from 'react-router';
import { NewNikountPage } from './features/create/NewNikountPage';
import { HomePage } from './features/home/HomePage';
import { NikountPage } from './features/nikount/NikountPage';
import { NotFoundPage } from './features/system/NotFoundPage';

/** Routes de l'application (docs/architecture.md §5). */
export const routes = [
  { path: '/', element: <HomePage /> },
  { path: '/new', element: <NewNikountPage /> },
  { path: '/n/:token/*', element: <NikountPage expectedRole="PARTICIPANT" /> },
  { path: '/a/:token/*', element: <NikountPage expectedRole="ADMIN" /> },
  { path: '*', element: <NotFoundPage /> },
];

export const router = createBrowserRouter(routes);
