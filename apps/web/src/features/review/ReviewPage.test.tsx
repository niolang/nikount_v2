import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { setDeclaredIdentity } from '../../lib/identity';
import {
  ADMIN_TOKEN,
  adminMe,
  errorBody,
  makeTransaction,
  mockApi,
  nikountView,
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
  localStorage.clear();
});

const pendingFuel = makeTransaction({
  id: '0193f0aa-0000-7000-8000-000000000a01',
  description: 'Essence',
  amount: 6800,
  status: 'PENDING',
  validatedAt: null,
  validatedBy: null,
  createdBy: { kind: 'PARTICIPANT', admin: null, declaredParticipantId: people.bob.id },
});
const pendingGroceries = makeTransaction({
  id: '0193f0aa-0000-7000-8000-000000000a02',
  description: 'Courses',
  amount: 4500,
  status: 'PENDING',
  validatedAt: null,
  validatedBy: null,
  version: 3,
  createdBy: { kind: 'PARTICIPANT', admin: null, declaredParticipantId: null },
});
const validated = makeTransaction({
  id: '0193f0aa-0000-7000-8000-000000000a03',
  description: 'Restaurant',
});

type Handler = Parameters<typeof mockApi>[0][string];

function mockAdmin(extra: Record<string, Handler> = {}, me: object = adminMe) {
  return mockApi({
    '/api/v1/me': () => ({ status: 200, body: me }),
    '/api/v1/participants': () => ({ status: 200, body: participantList }),
    '/api/v1/balances': () => ({
      status: 200,
      body: { ...zeroBalances, pending: { count: 2, amount: 11300 } },
    }),
    '/api/v1/transactions': () => ({
      status: 200,
      body: { transactions: [pendingFuel, pendingGroceries, validated] },
    }),
    ...extra,
  });
}

const bodyOf = (init: RequestInit | undefined) => JSON.parse(init?.body as string) as unknown;
const callsTo = (fetchMock: ReturnType<typeof mockApi>, url: string) =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && init?.method === 'POST');

describe('bandeau « à valider »', () => {
  it('apparaît sur l’accueil admin et mène à la file de validation', async () => {
    mockAdmin();
    const { router } = renderAt(`/a/${ADMIN_TOKEN}`);
    fireEvent.click(await screen.findByRole('link', { name: /2 opérations à valider/ }));
    expect(router.state.location.pathname).toBe(`/a/${ADMIN_TOKEN}/review`);
  });

  it('n’apparaît pas pour un participant, qui n’accède pas à la file', async () => {
    setDeclaredIdentity(PARTICIPANT_TOKEN, people.bob.id);
    mockAdmin({}, participantMe);
    const { router } = renderAt(`/n/${PARTICIPANT_TOKEN}/review`);
    expect(await screen.findByText(/Ton solde/)).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/n/${PARTICIPANT_TOKEN}`);
    expect(screen.queryByText(/à valider/)).toBeNull();
  });
});

describe('file de validation', () => {
  it('liste seulement les opérations en attente, avec le total et l’auteur', async () => {
    mockAdmin();
    renderAt(`/a/${ADMIN_TOKEN}/review`);
    expect(await screen.findByText('Essence')).toBeTruthy();
    expect(screen.getByText('Courses')).toBeTruthy();
    expect(screen.queryByText('Restaurant')).toBeNull();
    expect(
      screen.getByText(/2 opérations en attente/).textContent.replace(/[\u00a0\u202f]/g, ' '),
    ).toContain('113,00 €');
    expect(screen.getByText(/saisie par Bob/)).toBeTruthy();
  });

  it('valide une opération en envoyant sa version', async () => {
    const fetchMock = mockAdmin({
      [`/api/v1/transactions/${pendingGroceries.id}/validate`]: () => ({
        status: 200,
        body: { ...pendingGroceries, status: 'VALIDATED' },
      }),
    });
    renderAt(`/a/${ADMIN_TOKEN}/review`);
    fireEvent.click(await screen.findByRole('button', { name: 'Valider Courses' }));
    await vi.waitFor(() => {
      const [call] = callsTo(fetchMock, `/api/v1/transactions/${pendingGroceries.id}/validate`);
      expect(bodyOf(call?.[1])).toEqual({ version: 3 });
    });
  });

  it('refuse avec un motif après confirmation', async () => {
    const fetchMock = mockAdmin({
      [`/api/v1/transactions/${pendingFuel.id}/reject`]: () => ({
        status: 200,
        body: { ...pendingFuel, status: 'REJECTED' },
      }),
    });
    renderAt(`/a/${ADMIN_TOKEN}/review`);
    fireEvent.click(await screen.findByRole('button', { name: 'Refuser Essence' }));
    fireEvent.change(screen.getByLabelText(/Motif/), { target: { value: 'Trajet perso' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer le refus' }));
    await vi.waitFor(() => {
      const [call] = callsTo(fetchMock, `/api/v1/transactions/${pendingFuel.id}/reject`);
      expect(bodyOf(call?.[1])).toEqual({ version: 1, reason: 'Trajet perso' });
    });
  });

  it('« Valider tout » demande confirmation puis envoie une seule requête en masse', async () => {
    const fetchMock = mockAdmin({
      '/api/v1/transactions/bulk': () => ({ status: 200, body: { transactions: [] } }),
    });
    renderAt(`/a/${ADMIN_TOKEN}/review`);
    fireEvent.click(await screen.findByRole('button', { name: 'Valider tout (2)' }));
    expect(callsTo(fetchMock, '/api/v1/transactions/bulk')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer : valider les 2' }));
    await vi.waitFor(() => {
      const [call] = callsTo(fetchMock, '/api/v1/transactions/bulk');
      expect(bodyOf(call?.[1])).toEqual({
        action: 'validate',
        ids: [pendingFuel.id, pendingGroceries.id],
      });
    });
  });

  it('explique l’échec d’une validation en masse (tout ou rien)', async () => {
    mockAdmin({
      '/api/v1/transactions/bulk': () => ({
        status: 409,
        body: errorBody('INVALID_STATUS_TRANSITION'),
      }),
    });
    renderAt(`/a/${ADMIN_TOKEN}/review`);
    fireEvent.click(await screen.findByRole('button', { name: 'Valider tout (2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer : valider les 2' }));
    expect(await screen.findByText(/Aucune opération n’a été modifiée/)).toBeTruthy();
  });

  it('rien à valider', async () => {
    mockAdmin({
      '/api/v1/transactions': () => ({ status: 200, body: { transactions: [validated] } }),
    });
    renderAt(`/a/${ADMIN_TOKEN}/review`);
    expect(await screen.findByText(/Rien à valider/)).toBeTruthy();
  });
});

describe('actions sur le détail', () => {
  function mockDetail(transaction: ReturnType<typeof makeTransaction>, me: object = adminMe) {
    return mockAdmin(
      {
        [`/api/v1/transactions/${transaction.id}`]: () => ({ status: 200, body: transaction }),
        [`/api/v1/transactions/${transaction.id}/revisions`]: () => ({
          status: 200,
          body: { revisions: [] },
        }),
        [`/api/v1/transactions/${transaction.id}/cancel`]: () => ({
          status: 200,
          body: { ...transaction, status: 'CANCELLED' },
        }),
      },
      me,
    );
  }

  it('un admin annule une opération validée, avec motif et confirmation', async () => {
    const fetchMock = mockDetail(validated);
    renderAt(`/a/${ADMIN_TOKEN}/tx/${validated.id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Annuler cette opération' }));
    expect(screen.getByText(/restera visible dans l’historique/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Motif/), { target: { value: 'Doublon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer l’annulation' }));
    await vi.waitFor(() => {
      const [call] = callsTo(fetchMock, `/api/v1/transactions/${validated.id}/cancel`);
      expect(bodyOf(call?.[1])).toEqual({ version: 1, reason: 'Doublon' });
    });
  });

  it('un admin voit Valider / Refuser sur une opération en attente', async () => {
    mockDetail(pendingFuel);
    renderAt(`/a/${ADMIN_TOKEN}/tx/${pendingFuel.id}`);
    expect(await screen.findByRole('button', { name: 'Valider Essence' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refuser Essence' })).toBeTruthy();
  });

  it('un participant ne voit aucune action', async () => {
    setDeclaredIdentity(PARTICIPANT_TOKEN, people.bob.id);
    mockDetail(pendingFuel, participantMe);
    renderAt(`/n/${PARTICIPANT_TOKEN}/tx/${pendingFuel.id}`);
    expect(await screen.findByRole('heading', { name: 'Essence' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Valider|Refuser|Annuler/ })).toBeNull();
  });

  it('aucune action une fois le nikount clôturé', async () => {
    mockDetail(validated, { ...adminMe, nikount: { ...nikountView, state: 'CLOSED' } });
    renderAt(`/a/${ADMIN_TOKEN}/tx/${validated.id}`);
    expect(await screen.findByRole('heading', { name: 'Restaurant' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Annuler/ })).toBeNull();
  });
});
