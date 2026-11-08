import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import {
  ADMIN_ID,
  ADMIN_TOKEN,
  adminMe,
  errorBody,
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

const PAGE = `/a/${ADMIN_TOKEN}/settings`;
const OTHER_ADMIN_ID = '0193f0aa-0000-7000-8000-000000000002';
const NEW_ADMIN_TOKEN = `a_${'B'.repeat(43)}`;
const NEW_PARTICIPANT_TOKEN = `p_${'Q'.repeat(22)}`;

const adminItem = (overrides: Record<string, unknown> = {}) => ({
  id: ADMIN_ID,
  label: 'Nicolas',
  participantId: people.nicolas.id,
  createdAt: '2026-11-08T10:00:00.000Z',
  revokedAt: null,
  lastUsedAt: null,
  isYou: true,
  ...overrides,
});

const bodyOf = (init: RequestInit | undefined): unknown => JSON.parse(init?.body as string);

type Handlers = Parameters<typeof mockApi>[0];

function mockSettings(
  options: { state?: string; balances?: unknown; admins?: unknown[]; extra?: Handlers } = {},
) {
  const nikount = { ...nikountView, state: options.state ?? 'OPEN', version: 4 };
  return mockApi({
    '/api/v1/me': () => ({ status: 200, body: { ...adminMe, nikount } }),
    '/api/v1/participants': () => ({ status: 200, body: participantList }),
    '/api/v1/balances': () => ({ status: 200, body: options.balances ?? zeroBalances }),
    '/api/v1/admins': () => ({
      status: 200,
      body: { admins: options.admins ?? [adminItem()] },
    }),
    ...options.extra,
  });
}

const stateCard = async () =>
  (await screen.findByRole('heading', { name: 'État' })).closest('section') as HTMLElement;

describe('gestion du nikount : état', () => {
  it('OPEN : termine l’événement après confirmation (POST /nikount/state avec la version)', async () => {
    // Serveur à état : /me renvoie l'état après le changement.
    let nikount = { ...nikountView, version: 4 };
    const fetchMock = mockSettings({
      extra: {
        '/api/v1/me': () => ({ status: 200, body: { ...adminMe, nikount } }),
        '/api/v1/nikount/state': () => {
          nikount = { ...nikountView, state: 'SETTLEMENT', version: 5 };
          return { status: 200, body: nikount };
        },
      },
    });
    renderAt(PAGE);

    const card = await stateCard();
    fireEvent.click(await within(card).findByRole('button', { name: 'Terminer l’événement' }));
    expect(within(card).getByText(/Ferme les nouvelles dépenses/)).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Confirmer' }));

    expect(await within(card).findByRole('status')).toHaveProperty(
      'textContent',
      'Événement terminé : place aux remboursements.',
    );
    const post = fetchMock.mock.calls.find(([url]) => url === '/api/v1/nikount/state');
    expect(bodyOf(post?.[1])).toEqual({ to: 'SETTLEMENT', version: 4 });
    // Le badge suit le nouvel état sans rechargement.
    expect(await within(card).findByText('Règlement')).toBeTruthy();
  });

  it('SETTLEMENT : propose de rouvrir aux dépenses ou de clôturer', async () => {
    mockSettings({ state: 'SETTLEMENT' });
    renderAt(PAGE);
    const card = await stateCard();
    expect(await within(card).findByRole('button', { name: 'Rouvrir aux dépenses' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Clôturer les comptes' })).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Terminer l’événement' })).toBeNull();
  });

  it('bloque la clôture tant que des opérations sont en attente', async () => {
    mockSettings({
      state: 'SETTLEMENT',
      balances: { ...zeroBalances, pending: { count: 2, amount: 3000 } },
    });
    renderAt(PAGE);
    const card = await stateCard();
    await vi.waitFor(() => {
      expect(within(card).getByText(/2 opérations en attente/)).toBeTruthy();
    });
    expect(
      within(card).getByRole<HTMLButtonElement>('button', { name: 'Clôturer les comptes' })
        .disabled,
    ).toBe(true);
    expect(within(card).getByRole('link', { name: 'Les examiner' }).getAttribute('href')).toBe(
      `/a/${ADMIN_TOKEN}/review`,
    );
  });

  it('avertit (sans bloquer) quand les comptes ne sont pas soldés', async () => {
    const fetchMock = mockSettings({
      state: 'SETTLEMENT',
      balances: {
        ...zeroBalances,
        balances: [
          { participantId: people.nicolas.id, balance: 3000 },
          { participantId: people.alice.id, balance: -3000 },
        ],
      },
      extra: {
        '/api/v1/nikount/state': () => ({
          status: 200,
          body: { ...nikountView, state: 'CLOSED', version: 5 },
        }),
      },
    });
    renderAt(PAGE);
    const card = await stateCard();
    const close = await within(card).findByRole('button', { name: 'Clôturer les comptes' });
    await vi.waitFor(() => {
      expect((close as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(close);
    expect(within(card).getByText(/il reste 30,00\s€ à\s+rembourser/)).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Confirmer' }));
    await vi.waitFor(() => {
      const post = fetchMock.mock.calls.find(([url]) => url === '/api/v1/nikount/state');
      expect(bodyOf(post?.[1])).toEqual({ to: 'CLOSED', version: 4 });
    });
  });

  it('CLOSED : la réouverture exige un motif', async () => {
    const fetchMock = mockSettings({
      state: 'CLOSED',
      extra: {
        '/api/v1/nikount/state': () => ({
          status: 200,
          body: { ...nikountView, state: 'SETTLEMENT', version: 5 },
        }),
      },
    });
    renderAt(PAGE);
    const card = await stateCard();
    fireEvent.click(await within(card).findByRole('button', { name: 'Réouvrir (exceptionnel)' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Confirmer' }));
    expect(within(card).getByText('Motif obligatoire (200 caractères au plus).')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/v1/nikount/state')).toBe(false);

    fireEvent.change(within(card).getByLabelText('Motif de la réouverture'), {
      target: { value: '  Ticket de péage oublié ' },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Confirmer' }));
    await vi.waitFor(() => {
      const post = fetchMock.mock.calls.find(([url]) => url === '/api/v1/nikount/state');
      expect(bodyOf(post?.[1])).toEqual({
        to: 'SETTLEMENT',
        version: 4,
        reason: 'Ticket de péage oublié',
      });
    });
  });

  it('affiche le refus du serveur (opérations apparues entre-temps)', async () => {
    mockSettings({
      state: 'SETTLEMENT',
      extra: {
        '/api/v1/nikount/state': () => ({
          status: 409,
          body: errorBody(
            'PENDING_REMAINING',
            'Impossible de clôturer : 1 opération en attente de validation.',
          ),
        }),
      },
    });
    renderAt(PAGE);
    const card = await stateCard();
    const close = await within(card).findByRole('button', { name: 'Clôturer les comptes' });
    await vi.waitFor(() => {
      expect((close as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(close);
    fireEvent.click(within(card).getByRole('button', { name: 'Confirmer' }));
    expect((await within(card).findByRole('alert')).textContent).toBe(
      'Impossible de clôturer : 1 opération en attente de validation.',
    );
  });
});

describe('gestion du nikount : nom et lien', () => {
  it('renomme le nikount', async () => {
    const fetchMock = mockSettings({
      extra: {
        '/api/v1/nikount': () => ({
          status: 200,
          body: { ...nikountView, name: 'Week-end Annecy', version: 5 },
        }),
      },
    });
    renderAt(PAGE);
    const input = await screen.findByLabelText('Nom du nikount');
    const save = screen.getByRole('button', { name: 'Renommer' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: ' Week-end   Annecy ' } });
    fireEvent.click(save);
    expect(await screen.findByRole('button', { name: 'Enregistré ✓' })).toBeTruthy();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(bodyOf(patch?.[1])).toEqual({ name: 'Week-end Annecy', version: 4 });
  });

  it('remplace le lien du groupe après confirmation et affiche le nouveau', async () => {
    mockSettings({
      extra: {
        '/api/v1/nikount/participant-link/rotate': () => ({
          status: 200,
          body: { participantToken: NEW_PARTICIPANT_TOKEN },
        }),
      },
    });
    renderAt(PAGE);
    fireEvent.click(await screen.findByRole('button', { name: 'Changer le lien du groupe' }));
    expect(screen.getByText(/L’ancien lien ne fonctionnera plus pour personne/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remplacer le lien' }));
    const link = await screen.findByLabelText('Nouveau lien du groupe');
    expect((link as HTMLInputElement).value).toContain(`/n/${NEW_PARTICIPANT_TOKEN}`);
  });
});

describe('gestion du nikount : administrateurs', () => {
  it('liste les admins et ne permet pas de révoquer le dernier', async () => {
    mockSettings();
    renderAt(PAGE);
    expect(await screen.findByText('Nicolas (vous)')).toBeTruthy();
    expect(screen.getByText('Participant : Nicolas')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Révoquer/ })).toBeNull();
    expect(screen.getByText('Le dernier administrateur ne peut pas être révoqué.')).toBeTruthy();
  });

  it('crée un admin et affiche son lien une seule fois', async () => {
    const fetchMock = mockSettings({
      extra: {
        '/api/v1/admins': (init) =>
          init?.method === 'POST'
            ? {
                status: 201,
                body: {
                  admin: adminItem({
                    id: OTHER_ADMIN_ID,
                    label: 'Alice',
                    participantId: people.alice.id,
                    isYou: false,
                  }),
                  adminToken: NEW_ADMIN_TOKEN,
                },
              }
            : { status: 200, body: { admins: [adminItem()] } },
      },
    });
    renderAt(PAGE);
    await screen.findByRole('option', { name: 'Alice' });
    fireEvent.change(screen.getByLabelText('Nom de l’administrateur'), {
      target: { value: 'alice' },
    });
    // Le nom correspond à un participant : il est présélectionné.
    await vi.waitFor(() => {
      expect(
        screen.getByLabelText<HTMLSelectElement>('Participe aux dépenses en tant que').value,
      ).toBe(people.alice.id);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Créer un lien administrateur' }));

    const link = await screen.findByLabelText('Lien administrateur de Alice');
    expect((link as HTMLInputElement).value).toContain(`/a/${NEW_ADMIN_TOKEN}`);
    expect(screen.getByText(/plus jamais affiché/)).toBeTruthy();
    const post = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/v1/admins' && init?.method === 'POST',
    );
    expect(bodyOf(post?.[1])).toEqual({ label: 'alice', participantId: people.alice.id });

    fireEvent.click(screen.getByRole('button', { name: 'C’est fait' }));
    expect(screen.queryByLabelText('Lien administrateur de Alice')).toBeNull();
  });

  it('révoque un autre admin après confirmation', async () => {
    const fetchMock = mockSettings({
      admins: [adminItem(), adminItem({ id: OTHER_ADMIN_ID, label: 'Alice', isYou: false })],
      extra: {
        [`/api/v1/admins/${OTHER_ADMIN_ID}/revoke`]: () => ({
          status: 200,
          body: adminItem({
            id: OTHER_ADMIN_ID,
            label: 'Alice',
            isYou: false,
            revokedAt: '2026-11-08T12:00:00.000Z',
          }),
        }),
      },
    });
    renderAt(PAGE);
    fireEvent.click(await screen.findByRole('button', { name: 'Révoquer Alice' }));
    expect(screen.getByText('Le lien de Alice ne fonctionnera plus.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    await vi.waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => url === `/api/v1/admins/${OTHER_ADMIN_ID}/revoke`),
      ).toBe(true);
    });
  });

  it('se révoquer soi-même ramène à l’accueil', async () => {
    mockSettings({
      admins: [adminItem(), adminItem({ id: OTHER_ADMIN_ID, label: 'Alice', isYou: false })],
      extra: {
        [`/api/v1/admins/${ADMIN_ID}/revoke`]: () => ({
          status: 200,
          body: adminItem({ revokedAt: '2026-11-08T12:00:00.000Z' }),
        }),
      },
    });
    const { router } = renderAt(PAGE);
    fireEvent.click(await screen.findByRole('button', { name: 'Révoquer Nicolas' }));
    expect(screen.getByText(/vous perdrez l’accès administrateur/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
  });
});

describe('accès et entrées', () => {
  it('un participant est renvoyé à l’accueil du nikount', async () => {
    mockApi({
      '/api/v1/me': () => ({ status: 200, body: participantMe }),
      '/api/v1/participants': () => ({ status: 200, body: participantList }),
      '/api/v1/balances': () => ({ status: 200, body: zeroBalances }),
      '/api/v1/transactions': () => ({ status: 200, body: { transactions: [] } }),
    });
    const { router } = renderAt(`/n/${PARTICIPANT_TOKEN}/settings`);
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe(`/n/${PARTICIPANT_TOKEN}`);
    });
  });

  it('le menu admin mène à la gestion du nikount', async () => {
    mockSettings();
    renderAt(`/a/${ADMIN_TOKEN}/menu`);
    const link = await screen.findByRole('link', { name: /Gestion du nikount/ });
    expect(link.getAttribute('href')).toBe(`/a/${ADMIN_TOKEN}/settings`);
  });

  it('accueil admin : invite à clôturer quand tout est soldé', async () => {
    mockApi({
      '/api/v1/me': () => ({
        status: 200,
        body: { ...adminMe, nikount: { ...nikountView, state: 'SETTLEMENT' } },
      }),
      '/api/v1/participants': () => ({ status: 200, body: participantList }),
      '/api/v1/balances': () => ({ status: 200, body: zeroBalances }),
      '/api/v1/transactions': () => ({ status: 200, body: { transactions: [] } }),
    });
    renderAt(`/a/${ADMIN_TOKEN}`);
    const link = await screen.findByRole('link', { name: /Tout est soldé/ });
    expect(link.getAttribute('href')).toBe(`/a/${ADMIN_TOKEN}/settings`);
  });

  it('accueil : un nikount clôturé l’annonce', async () => {
    mockApi({
      '/api/v1/me': () => ({
        status: 200,
        body: { ...adminMe, nikount: { ...nikountView, state: 'CLOSED' } },
      }),
      '/api/v1/participants': () => ({ status: 200, body: participantList }),
      '/api/v1/balances': () => ({ status: 200, body: zeroBalances }),
      '/api/v1/transactions': () => ({ status: 200, body: { transactions: [] } }),
    });
    renderAt(`/a/${ADMIN_TOKEN}`);
    expect(await screen.findByText(/Ce nikount est clôturé/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: '+ Ajouter une dépense' })).toBeNull();
  });
});
