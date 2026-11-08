import { createBrowserRouter } from 'react-router';
import { HomePage } from './features/home/HomePage';
import { NotFoundPage } from './features/system/NotFoundPage';

/**
 * Routes de l'application (docs/architecture.md §5).
 * Phase 2 ajoutera /new, /n/:token/* (participant) et /a/:token/* (admin).
 */
export const routes = [
  { path: '/', element: <HomePage /> },
  { path: '*', element: <NotFoundPage /> },
];

export const router = createBrowserRouter(routes);
