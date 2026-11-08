import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { setDeclaredIdentity } from '../../lib/identity';
import {
  ADMIN_TOKEN,
  adminMe,
  mockApi,
  nikountView,
  participantList,
  participantMe,
  PARTICIPANT_TOKEN,
  people,
  renderAt,
} from '../../test/utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const plain = (value: string | null) => (value ?? '').replace(/[\u00a0\u202f]/g, ' ');
const shareOf = (id: string) => plain(screen.getByTestId(`share-${id}`).textContent);

function transactionFrom(body: Record<string, unknown>, status: string) {
  return {
    id: '0193f0aa-0000-7000-8000-000000000900',
    type: 'EXPENSE',
    status,
    amount: body['amount'],
    description: body['description'],
    category: body['category'] ?? null,
    occurredOn: body['occurredOn'],
    payerId: body['payerId'],
    distributionMode: 'EQUAL',
    shares: [],
    createdAt: '2026-11-08T10:00:00.000Z',
    createdBy: { kind: 'PARTICIPANT', admin: null, declaredParticipantId: null },
    validatedAt: null,
    validatedBy: null,
    version: 1,
  };
}

function mockNikount(me: object, created: { status: string } = { status: 'PENDING' }) {
  return mockApi({
    '/api/v1/me': () => ({ status: 200, body: me }),
    '/api/v1/participants': () => ({ status: 200, body: participantList }),
    '/api/v1/nikount/participant-link': () => ({
      status: 200,
      body: { participantToken: PARTICIPANT_TOKEN },
    }),
    '/api/v1/transactions': (init) =>
      init?.method === 'POST'
        ? {
            status: 201,
            body: transactionFrom(
              JSON.parse(init.body as string) as Record<string, unknown>,
              created.status,
            ),
          }
        : { status: 200, body: { transactions: [] } },
  });
}

describe('saisie d’une dépense (participant)', () => {
  it('pré-remplit le payeur avec « moi » et répartit à parts égales entre les actifs', async () => {
    setDeclaredIdentity(PARTICIPANT_TOKEN, people.bob.id);
    mockNikount(participantMe);
    renderAt(`/n/${PARTICIPANT_TOKEN}/expenses/new`);

    const payer = await screen.findByLabelText<HTMLSelectElement>('Payé par');
    expect(payer.value).toBe(people.bob.id);
    // Le participant désactivé n'est ni payeur possible ni concerné.
    expect(screen.queryByLabelText('Ancien')).toBeNull();

    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '120' } });
    expect(shareOf(people.nicolas.id)).toBe('40,00 €');
    expect(shareOf(people.alice.id)).toBe('40,00 €');
    expect(shareOf(people.bob.id)).toBe('40,00 €');

    // Décocher Alice : 60 € pour les deux autres.
    fireEvent.click(screen.getByLabelText('Alice'));
    expect(shareOf(people.alice.id)).toBe('—');
    expect(shareOf(people.bob.id)).toBe('60,00 €');
  });

  it('aperçu par pourcentage avec message tant que le total n’est pas 100 %', async () => {
    setDeclaredIdentity(PARTICIPANT_TOKEN, people.bob.id);
    mockNikount(participantMe);
    renderAt(`/n/${PARTICIPANT_TOKEN}/expenses/new`);

    fireEvent.change(await screen.findByLabelText('Montant'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: '%' }));
    fireEvent.change(screen.getByLabelText('% pour Nicolas'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('% pour Alice'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('% pour Bob'), { target: { value: '10' } });
    expect(screen.getByText('Total : 90 % — il faut 100 %.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('% pour Bob'), { target: { value: '20' } });
    expect(screen.queryByText(/il faut 100 %/)).toBeNull();
    expect(shareOf(people.nicolas.id)).toBe('50,00 €');
    expect(shareOf(people.bob.id)).toBe('20,00 €');
  });

  it('envoie la dépense (centimes, auteur déclaré, idempotence) puis revient à l’accueil', async () => {
    setDeclaredIdentity(PARTICIPANT_TOKEN, people.bob.id);
    const fetchMock = mockNikount(participantMe);
    const { router } = renderAt(`/n/${PARTICIPANT_TOKEN}/expenses/new`);

    fireEvent.change(await screen.findByLabelText('Montant'), { target: { value: '12,50' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Café' } });
    fireEvent.click(screen.getByRole('button', { name: /Repas/ }));
    fireEvent.click(screen.getByRole('button', { name: /Ajouter 12,50/ }));

    expect(await screen.findByText(/une fois validée par un administrateur/)).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/n/${PARTICIPANT_TOKEN}`);

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    const body = JSON.parse(post?.[1]?.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: 'EXPENSE',
      amount: 1250,
      description: 'Café',
      category: 'FOOD',
      payerId: people.bob.id,
      declaredByParticipantId: people.bob.id,
      distribution: {
        mode: 'EQUAL',
        participantIds: [people.nicolas.id, people.alice.id, people.bob.id],
      },
    });
    expect(body['clientRequestId']).toMatch(/^[0-9a-f-]{36}$/);
    expect(body['occurredOn']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('bloque l’envoi tant que la saisie est incomplète', async () => {
    setDeclaredIdentity(PARTICIPANT_TOKEN, people.bob.id);
    const fetchMock = mockNikount(participantMe);
    renderAt(`/n/${PARTICIPANT_TOKEN}/expenses/new`);

    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter la dépense' }));
    expect(screen.getByText('Montant positif, 2 décimales au plus.')).toBeTruthy();
    expect(screen.getByText('Décrivez la dépense en quelques mots.')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
});

describe('saisie d’une dépense (admin) et état du nikount', () => {
  it('l’admin voit sa dépense validée directement', async () => {
    mockNikount(adminMe, { status: 'VALIDATED' });
    renderAt(`/a/${ADMIN_TOKEN}/expenses/new`);

    expect((await screen.findByLabelText<HTMLSelectElement>('Payé par')).value).toBe(
      people.nicolas.id,
    );
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Pain' } });
    fireEvent.click(screen.getByRole('button', { name: /Ajouter 30,00/ }));
    expect(await screen.findByText('Dépense ajoutée.')).toBeTruthy();
  });

  it('refuse la saisie quand le nikount est en règlement', async () => {
    mockNikount({ ...adminMe, nikount: { ...nikountView, state: 'SETTLEMENT' } });
    renderAt(`/a/${ADMIN_TOKEN}/expenses/new`);
    expect(await screen.findByText(/ne sont plus acceptées/)).toBeTruthy();
    expect(screen.queryByLabelText('Montant')).toBeNull();
  });
});

describe('accueil', () => {
  it('affiche le bouton d’ajout et les dernières opérations avec leur statut', async () => {
    mockApi({
      '/api/v1/me': () => ({ status: 200, body: adminMe }),
      '/api/v1/participants': () => ({ status: 200, body: participantList }),
      '/api/v1/nikount/participant-link': () => ({
        status: 200,
        body: { participantToken: PARTICIPANT_TOKEN },
      }),
      '/api/v1/transactions': () => ({
        status: 200,
        body: {
          transactions: [
            {
              ...transactionFrom(
                {
                  amount: 6800,
                  description: 'Essence',
                  category: 'TRANSPORT',
                  occurredOn: '2026-09-28',
                  payerId: people.bob.id,
                },
                'PENDING',
              ),
            },
          ],
        },
      }),
    });
    renderAt(`/a/${ADMIN_TOKEN}`);

    expect(await screen.findByRole('link', { name: '+ Ajouter une dépense' })).toBeTruthy();
    expect(await screen.findByText('Essence')).toBeTruthy();
    expect(screen.getByText('⏳ En attente')).toBeTruthy();
    expect(plain(screen.getByText(/68,00/).textContent)).toBe('68,00 €');
  });
});
