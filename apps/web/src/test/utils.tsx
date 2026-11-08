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
  stateChangedAt: '2026-11-08T10:00:00.000Z',
  createdAt: '2026-11-08T10:00:00.000Z',
  version: 1,
};

export const errorBody = (code: string, message = code) => ({
  error: { code, message },
  requestId: 'req-1',
});

const person = (n: number, name: string, isActive = true) => ({
  id: `0193f0aa-0000-7000-8000-00000000010${String(n)}`,
  name,
  isActive,
  sortOrder: n,
  version: 1,
});

export const people = {
  nicolas: person(0, 'Nicolas'),
  alice: person(1, 'Alice'),
  bob: person(2, 'Bob'),
  ancien: person(3, 'Ancien', false),
};

export const participantList = { participants: Object.values(people) };

export const ADMIN_ID = '0193f0aa-0000-7000-8000-000000000001';

export const adminMe = {
  role: 'ADMIN',
  admin: { id: ADMIN_ID, label: 'Nicolas', participantId: people.nicolas.id },
  nikount: nikountView,
};

export const participantMe = { role: 'PARTICIPANT', admin: null, nikount: nikountView };

/** Opération complète (format de l'API) avec des valeurs par défaut surchargeables. */
export function makeTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: '0193f0aa-0000-7000-8000-000000000900',
    type: 'EXPENSE',
    status: 'VALIDATED',
    amount: 12000,
    description: 'Restaurant',
    category: 'FOOD',
    occurredOn: '2026-09-28',
    payerId: people.alice.id,
    distributionMode: 'EQUAL',
    shares: [],
    createdAt: '2026-09-28T18:42:00.000Z',
    createdBy: {
      kind: 'ADMIN',
      admin: { id: ADMIN_ID, label: 'Nicolas' },
      declaredParticipantId: null,
    },
    validatedAt: '2026-09-28T18:42:00.000Z',
    validatedBy: { id: ADMIN_ID, label: 'Nicolas' },
    rejectedAt: null,
    rejectedBy: null,
    rejectionReason: null,
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    version: 1,
    ...overrides,
  };
}

/** Soldes tous à zéro (pour les écrans qui n'en testent pas le contenu). */
export const zeroBalances = {
  balances: Object.values(people).map((p) => ({ participantId: p.id, balance: 0 })),
  nextPayerId: null,
  settlementSuggestions: [],
  pending: { count: 0, amount: 0 },
};
