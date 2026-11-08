import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import {
  ADMIN_ID,
  ADMIN_TOKEN,
  adminMe,
  makeTransaction,
  mockApi,
  participantList,
  participantMe,
  PARTICIPANT_TOKEN,
  people,
  renderAt,
  zeroBalances,
} from '../../test/utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const fuel = makeTransaction({
  id: '0193f0aa-0000-7000-8000-000000000c01',
  description: 'Essence',
});

const event = (id: number, overrides: Record<string, unknown>) => ({
  id,
  occurredAt: '2026-09-28T18:42:00.000Z',
  actor: { kind: 'ADMIN', admin: { id: ADMIN_ID, label: 'Nicolas' }, participantId: null },
  action: 'nikount.created',
  entityType: null,
  entityId: null,
  data: {},
  ...overrides,
});

const firstPage = {
  events: [
    event(3, {
      action: 'transaction.validated',
      entityType: 'transaction',
      entityId: fuel.id,
      data: { from: 'PENDING', to: 'VALIDATED' },
    }),
    event(2, {
      action: 'transaction.created',
      actor: { kind: 'PARTICIPANT', admin: null, participantId: people.bob.id },
      entityType: 'transaction',
      entityId: fuel.id,
      data: { type: 'EXPENSE', description: 'Essence', amount: 6800, status: 'PENDING' },
    }),
  ],
  nextBefore: 2,
};

function mockAudit(extra: Parameters<typeof mockApi>[0] = {}, me: object = adminMe) {
  return mockApi({
    '/api/v1/me': () => ({ status: 200, body: me }),
    '/api/v1/participants': () => ({ status: 200, body: participantList }),
    '/api/v1/balances': () => ({ status: 200, body: zeroBalances }),
    '/api/v1/transactions': () => ({ status: 200, body: { transactions: [fuel] } }),
    '/api/v1/audit': () => ({ status: 200, body: firstPage }),
    '/api/v1/audit?before=2': () => ({
      status: 200,
      body: { events: [event(1, { data: { name: 'Weekend' } })], nextBefore: null },
    }),
    '/api/v1/audit?action=participant': () => ({
      status: 200,
      body: { events: [], nextBefore: null },
    }),
    ...extra,
  });
}

describe('journal d’audit', () => {
  it('raconte qui a fait quoi, avec un lien vers l’opération', async () => {
    mockAudit();
    renderAt(`/a/${ADMIN_TOKEN}/audit`);
    const validated = await screen.findByText(/a validé « Essence »/);
    expect(validated.textContent).toBe('Nicolas a validé « Essence »');
    expect(screen.getByText(/a ajouté une dépense/).textContent.replace(/\u00a0/g, ' ')).toBe(
      'Bob a ajouté une dépense : « Essence », 68,00 € (en attente de validation)',
    );
    expect(screen.getAllByRole('link', { name: 'Voir l’opération' })[0]?.getAttribute('href')).toBe(
      `/a/${ADMIN_TOKEN}/tx/${fuel.id}`,
    );
  });

  it('charge les événements plus anciens à la demande', async () => {
    mockAudit();
    renderAt(`/a/${ADMIN_TOKEN}/audit`);
    fireEvent.click(await screen.findByRole('button', { name: 'Plus ancien' }));
    expect(await screen.findByText(/a créé le nikount « Weekend »/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Plus ancien' })).toBeNull();
  });

  it('filtre par famille d’actions', async () => {
    const fetchMock = mockAudit();
    renderAt(`/a/${ADMIN_TOKEN}/audit`);
    await screen.findByText(/a validé/);
    fireEvent.click(screen.getByRole('button', { name: 'Participants' }));
    expect(await screen.findByText('Aucun événement.')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/v1/audit?action=participant')).toBe(
      true,
    );
  });

  it('est réservé aux admins', async () => {
    mockAudit({}, participantMe);
    const { router } = renderAt(`/n/${PARTICIPANT_TOKEN}/audit`);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/n/${PARTICIPANT_TOKEN}`);
    });
  });
});
