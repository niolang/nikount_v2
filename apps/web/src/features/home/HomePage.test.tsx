import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '../../router';

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('page d’accueil', () => {
  it('affiche le service opérationnel quand l’API répond', async () => {
    mockFetch(200, { status: 'ok', database: 'up' });
    renderAt('/');

    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('dépenses du groupe');
    expect(await screen.findByText('Service opérationnel')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/health',
      expect.objectContaining({ credentials: 'omit' }),
    );
  });

  it('affiche le service indisponible quand la base est en panne (503)', async () => {
    mockFetch(503, { status: 'degraded', database: 'down' });
    renderAt('/');

    expect(await screen.findByText('Service indisponible')).toBeTruthy();
  });
});

describe('route inconnue', () => {
  it('affiche la page introuvable', () => {
    mockFetch(200, {});
    renderAt('/n/inconnu/rien');

    expect(screen.getByRole('heading', { name: 'Page introuvable' })).toBeTruthy();
  });
});
