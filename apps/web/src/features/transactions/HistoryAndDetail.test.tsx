import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { setDeclaredIdentity } from '../../lib/identity';
import { todayIn } from '../../lib/dates';
import {
  ADMIN_ID,
  errorBody,
  makeTransaction,
  mockApi,
  participantList,
  participantMe,
  PARTICIPANT_TOKEN,
  people,
  renderAt,
} from '../../test/utils';
import { inputLabel } from './TransactionDetailPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const plain = (value: string | null) => (value ?? '').replace(/[\u00a0\u202f]/g, ' ');
const today = todayIn('Europe/Paris');
const BASE = `/n/${PARTICIPANT_TOKEN}`;

const restaurant = makeTransaction({
  id: '0193f0aa-0000-7000-8000-000000000901',
  description: 'Restaurant',
  occurredOn: today,
  payerId: people.alice.id,
  distributionMode: 'SHARES',
  shares: [
    { participantId: people.nicolas.id, inputValue: 1, amount: 2000 },
    { participantId: people.alice.id, inputValue: 1, amount: 2000 },
    { participantId: people.bob.id, inputValue: 2, amount: 4000 },
  ],
  amount: 8000,
});
const refund = makeTransaction({
  id: '0193f0aa-0000-7000-8000-000000000902',
  type: 'REIMBURSEMENT',
  category: null,
  description: 'Remboursement',
  occurredOn: today,
  amount: 3000,
  payerId: people.bob.id,
  shares: [{ participantId: people.alice.id, inputValue: 1, amount: 3000 }],
});
const cancelledBar = makeTransaction({
  id: '0193f0aa-0000-7000-8000-000000000903',
  description: 'Bar',
  occurredOn: '2026-09-20',
  amount: 4500,
  status: 'CANCELLED',
  cancelledAt: '2026-09-28T20:14:00.000Z',
  cancelledBy: { id: ADMIN_ID, label: 'Nicolas' },
  cancellationReason: 'Doublon',
});
const pendingFuel = makeTransaction({
  id: '0193f0aa-0000-7000-8000-000000000904',
  description: 'Essence',
  category: 'TRANSPORT',
  occurredOn: '2026-09-20',
  amount: 6800,
  status: 'PENDING',
  validatedAt: null,
  validatedBy: null,
  createdBy: { kind: 'PARTICIPANT', admin: null, declaredParticipantId: people.bob.id },
});

function mockHistory(extra: Record<string, () => { status: number; body: unknown }> = {}) {
  setDeclaredIdentity(PARTICIPANT_TOKEN, people.bob.id);
  return mockApi({
    '/api/v1/me': () => ({ status: 200, body: participantMe }),
    '/api/v1/participants': () => ({ status: 200, body: participantList }),
    '/api/v1/transactions': () => ({
      status: 200,
      body: { transactions: [restaurant, refund, pendingFuel, cancelledBar] },
    }),
    ...extra,
  });
}

describe('historique', () => {
  it('groupe par jour et affiche payeur, remboursement « Bob → Alice » et statuts', async () => {
    mockHistory();
    renderAt(`${BASE}/history`);

    const todayGroup = within(await screen.findByRole('region', { name: 'Aujourd’hui' }));
    expect(todayGroup.getByText('Restaurant')).toBeTruthy();
    expect(todayGroup.getByText('Bob → Alice')).toBeTruthy();

    const older = within(screen.getByRole('region', { name: 'Dimanche 20 septembre' }));
    expect(older.getByText('⏳ En attente')).toBeTruthy();
    expect(older.getByText('Annulée')).toBeTruthy();
    // L'opération annulée reste visible, barrée.
    expect(older.getByText('Bar').className).toContain('line-through');
  });

  it('filtre par type et par statut', async () => {
    mockHistory();
    renderAt(`${BASE}/history?filter=REIMBURSEMENT`);
    expect(await screen.findByText('Bob → Alice')).toBeTruthy();
    expect(screen.queryByText('Restaurant')).toBeNull();
    expect(plain(screen.getByText(/Total validé/).textContent)).toBe('Total validé : 30,00 €');

    fireEvent.click(screen.getByRole('link', { name: 'Annulées / refusées' }));
    expect(await screen.findByText('Bar')).toBeTruthy();
    expect(screen.queryByText('Essence')).toBeNull();
  });

  it('message quand rien ne correspond', async () => {
    setDeclaredIdentity(PARTICIPANT_TOKEN, people.bob.id);
    mockApi({
      '/api/v1/me': () => ({ status: 200, body: participantMe }),
      '/api/v1/participants': () => ({ status: 200, body: participantList }),
      '/api/v1/transactions': () => ({ status: 200, body: { transactions: [] } }),
    });
    renderAt(`${BASE}/history?filter=PENDING`);
    expect(await screen.findByText(/Aucune opération ici/)).toBeTruthy();
  });

  it('une ligne mène au détail', async () => {
    mockHistory({
      [`/api/v1/transactions/${restaurant.id}`]: () => ({ status: 200, body: restaurant }),
      [`/api/v1/transactions/${restaurant.id}/revisions`]: () => ({
        status: 200,
        body: { revisions: [] },
      }),
    });
    const { router } = renderAt(`${BASE}/history`);
    fireEvent.click(await screen.findByText('Restaurant'));
    expect(router.state.location.pathname).toBe(`${BASE}/tx/${restaurant.id}`);
  });
});

describe('détail d’une opération', () => {
  function mockDetail(transaction: ReturnType<typeof makeTransaction>, revisions: unknown[] = []) {
    return mockHistory({
      [`/api/v1/transactions/${transaction.id}`]: () => ({
        status: 200,
        body: transaction,
      }),
      [`/api/v1/transactions/${transaction.id}/revisions`]: () => ({
        status: 200,
        body: { revisions },
      }),
    });
  }

  it('dépense par parts : « 2 parts → 40,00 € », mode, payeur, validation', async () => {
    mockDetail(restaurant, [
      {
        revision: 1,
        createdAt: '2026-09-28T18:42:00.000Z',
        changedBy: {
          kind: 'ADMIN',
          admin: { id: ADMIN_ID, label: 'Nicolas' },
          declaredParticipantId: null,
        },
        reason: null,
      },
    ]);
    renderAt(`${BASE}/tx/${restaurant.id}`);

    expect(await screen.findByRole('heading', { name: 'Restaurant' })).toBeTruthy();
    expect(screen.getByText(/Payé par/).textContent).toBe('Payé par Alice');
    expect(screen.getByText(/Concernés · Par parts/)).toBeTruthy();
    const bobLine = screen.getByText('Bob').closest('li');
    expect(plain(bobLine?.textContent ?? null)).toBe('Bob2 parts → 40,00 €');
    expect(plain(screen.getByText(/Validée par Nicolas/).textContent)).toBe(
      '✓ Validée par Nicolas · 28/09/2026 20:42',
    );
    expect(plain(await screen.findByText(/Saisie par Nicolas/).then((n) => n.textContent))).toBe(
      'Saisie par Nicolas (admin) · 28/09/2026 20:42',
    );
  });

  it('remboursement : « Bob a remboursé Alice », sans liste de concernés', async () => {
    mockDetail(refund);
    renderAt(`${BASE}/tx/${refund.id}`);
    expect(plain((await screen.findByText(/a remboursé/)).textContent)).toBe(
      'Bob a remboursé Alice',
    );
    expect(screen.queryByText(/Concernés/)).toBeNull();
  });

  it('annulée : qui, quand, motif, montant barré', async () => {
    mockDetail(cancelledBar);
    renderAt(`${BASE}/tx/${cancelledBar.id}`);
    expect(plain((await screen.findByText(/Annulée par Nicolas/)).textContent)).toBe(
      'Annulée par Nicolas · 28/09/2026 22:14 — non comptée.',
    );
    expect(screen.getByText('Motif : « Doublon »')).toBeTruthy();
  });

  it('en attente : signalée comme non comptée, auteur déclaré', async () => {
    mockDetail(pendingFuel);
    renderAt(`${BASE}/tx/${pendingFuel.id}`);
    expect(await screen.findByText(/En attente de validation/)).toBeTruthy();
    expect(plain(screen.getByText(/Saisie par Bob/).textContent)).toContain('Saisie par Bob ·');
  });

  it('opération introuvable (autre nikount ou supprimée du lien)', async () => {
    const missing = '0193f0aa-0000-7000-8000-000000000999';
    mockHistory({
      [`/api/v1/transactions/${missing}`]: () => ({ status: 404, body: errorBody('NOT_FOUND') }),
      [`/api/v1/transactions/${missing}/revisions`]: () => ({
        status: 404,
        body: errorBody('NOT_FOUND'),
      }),
    });
    renderAt(`${BASE}/tx/${missing}`);
    expect(await screen.findByText('Cette opération n’existe pas dans ce nikount.')).toBeTruthy();
  });
});

describe('inputLabel', () => {
  it.each([
    ['SHARES', 1, '1 part'],
    ['SHARES', 1.5, '1,5 part'],
    ['SHARES', 2, '2 parts'],
    ['PERCENT', 33.33, '33,33 %'],
    ['EQUAL', 1, null],
    ['AMOUNT', 2000, null],
  ] as const)('%s %s → %s', (mode, value, expected) => {
    expect(inputLabel(mode, value)).toBe(expected);
  });
});
