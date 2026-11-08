import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { routes } from '../router';

export const PARTICIPANT_TOKEN = `p_${'P'.repeat(22)}`;
export const ADMIN_TOKEN = `a_${'A'.repeat(43)}`;

export function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, router };
}

type Handler = (init: RequestInit | undefined) => { status: number; body: unknown };

/** Simule l'API : une réponse par chemin (`/api/v1/...`). */
export function mockApi(handlers: Record<string, Handler>) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const handler = handlers[url];
    const { status, body } = handler ? handler(init) : { status: 404, body: {} };
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export const nikountView = {
  name: 'Weekend Chamonix',
  currency: 'EUR',
  timezone: 'Europe/Paris',
  state: 'OPEN',
  createdAt: '2026-11-08T10:00:00.000Z',
};

export const errorBody = (code: string) => ({
  error: { code, message: code },
  requestId: 'req-1',
});
