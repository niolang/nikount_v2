import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { setDeclaredIdentity } from '../../lib/identity';
import {
  ADMIN_TOKEN,
  adminMe,
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
import { readPrefill } from './ReimbursementFormPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const BASE = `/n/${PARTICIPANT_TOKEN}`;

/** Soldes : Nicolas doit recevoir de Bob ; l'ancien participant (désactivé) doit à Nicolas. */
const balancesWithDebts = {
  balances: [
    { participantId: people.nicolas.id, balance: 4300 },
    { participantId: people.alice.id, balance: 0 },
    { participantId: people.bob.id, balance: -4250 },
    { participantId: people.ancien.id, balance: -50 },
  ],
  nextPayerId: people.bob.id,
  settlementSuggestions: [
    { from: people.bob.id, to: people.nicolas.id, amount: 4250 },
    { from: people.ancien.id, to: people.nicolas.id, amount: 50 },
  ],
  pending: { count: 0, amount: 0 },
};

function mockNikount(me: object = participantMe, balances: object = balancesWithDebts) {
  return mockApi({
    '/api/v1/me': () => ({ status: 200, body: me }),
    '/api/v1/participants': () => ({ status: 200, body: participantList }),
    '/api/v1/balances': () => ({ status: 200, body: balances }),
    '/api/v1/nikount/participant-link': () => ({
      status: 200,
      body: { participantToken: PARTICIPANT_TOKEN },
    }),
    '/api/v1/transactions': (init) => {
      if (init?.method !== 'POST') return { status: 200, body: { transactions: [] } };
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      const isAdmin = (me as { role: string }).role === 'ADMIN';
      return {
        status: 201,
        body: makeTransaction({
          type: 'REIMBURSEMENT',
          category: null,
          amount: body['amount'],
          description: body['description'],
          occurredOn: body['occurredOn'],
          payerId: body['payerId'],
          ...(isAdmin
            ? {}
            : {
                status: 'PENDING',
                validatedAt: null,
                validatedBy: null,
                createdBy: { kind: 'PARTICIPANT', admin: null, declaredParticipantId: null },
              }),
        }),
      };
    },
  });
}

const postBody = (fetchMock: ReturnType<typeof mockApi>) => {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
  return JSON.parse(call?.[1]?.body as string) as Record<string, unknown>;
};

describe('readPrefill', () => {
  const active = new Set(['a', 'b']);
  const read = (query: string) => readPrefill(new URLSearchParams(query), active);

  it('reprend un virement suggéré valide', () => {
    expect(read('from=a&to=b&amount=4250')).toEqual({ from: 'a', to: 'b', amount: 4250 });
  });

  it.each([
    ['participant inconnu', 'from=x&to=b&amount=1', { from: null, to: 'b', amount: 1 }],
    ['même personne', 'from=a&to=a&amount=1', { from: 'a', to: null, amount: 1 }],
    ['montant décimal', 'from=a&to=b&amount=12.5', { from: 'a', to: 'b', amount: null }],
    ['montant nul', 'from=a&to=b&amount=0', { from: 'a', to: 'b', amount: null }],
    ['montant trop grand', 'from=a&to=b&amount=100000001', { from: 'a', to: 'b', amount: null }],
    ['rien', '', { from: null, to: null, amount: null }],
  ])('ignore : %s', (_label, query, expected) => {
    expect(read(query)).toEqual(expected);
  });
});

describe('saisie d’un remboursement', () => {
  it('depuis un virement suggéré : formulaire pré-rempli, envoi, retour avec message', async () => {
    setDeclaredIdentity(PARTICIPANT_TOKEN, people.bob.id);
    const fetchMock = mockNikount();
    const { router } = renderAt(BASE);

    fireEvent.click(await screen.findByText(/Comment tout solder/));
    fireEvent.click(
      screen.getByRole('link', { name: 'Enregistrer le remboursement de Bob (vous) à Nicolas' }),
    );

    expect((await screen.findByLabelText<HTMLSelectElement>('Qui rembourse ?')).value).toBe(
      people.bob.id,
    );
    expect(screen.getByLabelText<HTMLSelectElement>('À qui ?').value).toBe(people.nicolas.id);
    expect(screen.getByLabelText<HTMLInputElement>('Montant').value).toBe('42,50');

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le remboursement' }));
    expect(await screen.findByText(/une fois validé par un administrateur/)).toBeTruthy();
    expect(router.state.location.pathname).toBe(BASE);

    const body = postBody(fetchMock);
    expect(body).toMatchObject({
      type: 'REIMBURSEMENT',
      amount: 4250,
      description: 'Remboursement',
      category: null,
      payerId: people.bob.id,
      distribution: { mode: 'EQUAL', participantIds: [people.nicolas.id] },
      declaredByParticipantId: people.bob.id,
    });
    expect(body['clientRequestId']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('pas de lien pour un virement impliquant un participant désactivé', async () => {
    setDeclaredIdentity(PARTICIPANT_TOKEN, people.bob.id);
    mockNikount();
    renderAt(BASE);
    fireEvent.click(await screen.findByText(/Comment tout solder/));
    expect(screen.getByText('Ancien (désactivé) → Nicolas')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /remboursement de Ancien/ })).toBeNull();
  });

  it('sans pré-remplissage : « moi » rembourse le premier autre participant', async () => {
    setDeclaredIdentity(PARTICIPANT_TOKEN, people.alice.id);
    mockNikount();
    renderAt(`${BASE}/reimbursements/new`);
    expect((await screen.findByLabelText<HTMLSelectElement>('Qui rembourse ?')).value).toBe(
      people.alice.id,
    );
    expect(screen.getByLabelText<HTMLSelectElement>('À qui ?').value).toBe(people.nicolas.id);
  });

  it('refuse de se rembourser soi-même et un montant manquant', async () => {
    setDeclaredIdentity(PARTICIPANT_TOKEN, people.alice.id);
    const fetchMock = mockNikount();
    renderAt(`${BASE}/reimbursements/new`);
    fireEvent.change(await screen.findByLabelText('À qui ?'), {
      target: { value: people.alice.id },
    });
    expect(screen.getByText('On ne se rembourse pas soi-même.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le remboursement' }));
    expect(screen.getByText('Montant positif, 2 décimales au plus.')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('résume l’effet avant l’envoi', async () => {
    setDeclaredIdentity(PARTICIPANT_TOKEN, people.bob.id);
    mockNikount();
    renderAt(`${BASE}/reimbursements/new?to=${people.nicolas.id}`);
    fireEvent.change(await screen.findByLabelText('Montant'), { target: { value: '10' } });
    expect(screen.getByRole('status').textContent.replace(/[\u00a0\u202f]/g, ' ')).toContain(
      'Bob rembourse 10,00 € à Nicolas',
    );
  });

  it('un admin enregistre un remboursement validé d’emblée', async () => {
    mockNikount(adminMe);
    renderAt(`/a/${ADMIN_TOKEN}/reimbursements/new`);
    fireEvent.change(await screen.findByLabelText('Montant'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le remboursement' }));
    expect(await screen.findByText('Remboursement enregistré.')).toBeTruthy();
  });
});

describe('phase de règlement et clôture', () => {
  const settlement = { ...participantMe, nikount: { ...nikountView, state: 'SETTLEMENT' } };

  it('en règlement : plus de dépense, remboursement mis en avant, virements dépliés', async () => {
    setDeclaredIdentity(PARTICIPANT_TOKEN, people.bob.id);
    mockNikount(settlement);
    renderAt(BASE);
    expect(await screen.findByRole('link', { name: '💸 Remboursement' })).toBeTruthy();
    expect(screen.getByText(/il ne reste qu’à solder les comptes/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: '+ Ajouter une dépense' })).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Enregistrer le remboursement de Bob (vous) à Nicolas' }),
    ).toBeTruthy();
  });

  it('clôturé : ni dépense ni remboursement, virements non cliquables', async () => {
    setDeclaredIdentity(PARTICIPANT_TOKEN, people.bob.id);
    mockNikount({ ...participantMe, nikount: { ...nikountView, state: 'CLOSED' } });
    renderAt(BASE);
    fireEvent.click(await screen.findByText(/Comment tout solder/));
    expect(screen.queryByRole('link', { name: '💸 Remboursement' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Enregistrer le remboursement/ })).toBeNull();
    expect(screen.queryByRole('link', { name: '+ Ajouter une dépense' })).toBeNull();
  });

  it('clôturé : le formulaire l’explique', async () => {
    mockNikount({ ...adminMe, nikount: { ...nikountView, state: 'CLOSED' } });
    renderAt(`/a/${ADMIN_TOKEN}/reimbursements/new`);
    expect(await screen.findByText(/plus aucun remboursement/)).toBeTruthy();
  });
});

describe('onglet « Remboursements »', () => {
  it('propose d’enregistrer un remboursement', async () => {
    setDeclaredIdentity(PARTICIPANT_TOKEN, people.bob.id);
    mockNikount(participantMe, zeroBalances);
    const { router } = renderAt(`${BASE}/history?filter=REIMBURSEMENT`);
    fireEvent.click(await screen.findByRole('link', { name: '💸 Enregistrer un remboursement' }));
    expect(router.state.location.pathname).toBe(`${BASE}/reimbursements/new`);
  });
});
