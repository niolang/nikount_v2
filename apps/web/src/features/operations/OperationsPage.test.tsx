import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
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

const share = (participantId: string, amount: number, inputValue = 1) => ({
  participantId,
  inputValue,
  amount,
});

const restaurant = makeTransaction({
  id: '0193f0aa-0000-7000-8000-000000000b01',
  description: 'Restaurant',
  amount: 12000,
  occurredOn: '2026-09-28',
  payerId: people.alice.id,
  shares: [share(people.alice.id, 6000), share(people.bob.id, 6000)],
  version: 2,
});
const fuel = makeTransaction({
  id: '0193f0aa-0000-7000-8000-000000000b02',
  description: 'Essence',
  category: 'TRANSPORT',
  amount: 6800,
  occurredOn: '2026-09-27',
  status: 'PENDING',
  payerId: people.bob.id,
  shares: [share(people.nicolas.id, 3400), share(people.bob.id, 3400)],
});
const groceries = makeTransaction({
  id: '0193f0aa-0000-7000-8000-000000000b03',
  description: 'Courses',
  category: 'GROCERIES',
  amount: 4500,
  occurredOn: '2026-09-26',
  status: 'PENDING',
  payerId: people.alice.id,
  shares: [share(people.alice.id, 4500)],
});
const all = [restaurant, fuel, groceries];

type Handler = Parameters<typeof mockApi>[0][string];

function mockAdmin(extra: Record<string, Handler> = {}, me: object = adminMe) {
  return mockApi({
    '/api/v1/me': () => ({ status: 200, body: me }),
    '/api/v1/participants': () => ({ status: 200, body: participantList }),
    '/api/v1/balances': () => ({
      status: 200,
      body: { ...zeroBalances, pending: { count: 2, amount: 11300 } },
    }),
    '/api/v1/transactions': () => ({ status: 200, body: { transactions: all } }),
    ...extra,
  });
}

const bodyOf = (init: RequestInit | undefined) => JSON.parse(init?.body as string) as unknown;
const callsTo = (fetchMock: ReturnType<typeof mockApi>, url: string, method: string) =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && init?.method === method);

async function openTable() {
  renderAt(`/a/${ADMIN_TOKEN}/operations`);
  await screen.findByRole('table');
}
const bodyRows = () => screen.getAllByRole('row').slice(1);
const descriptions = () =>
  bodyRows().map(
    (row) =>
      within(row).getByRole('button', { name: /\(modifier : Description/ }).firstChild?.textContent,
  );

describe('table des opérations', () => {
  it('liste toutes les opérations, plus récentes d’abord, avec le total des dépenses validées', async () => {
    mockAdmin();
    await openTable();
    expect(descriptions()).toEqual(['Restaurant', 'Essence', 'Courses']);
    expect(screen.getByText(/3 opérations/).textContent.replace(/[\u00a0\u202f]/g, ' ')).toContain(
      '120,00 €',
    );
  });

  it('recherche et filtre, avec un compteur et une remise à zéro', async () => {
    mockAdmin();
    await openTable();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Rechercher' }), {
      target: { value: 'nicolas' },
    });
    expect(descriptions()).toEqual(['Essence']);
    expect(screen.getByText(/1 opération sur 3/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser (1)' }));
    fireEvent.change(screen.getByLabelText('Statut'), { target: { value: 'PENDING' } });
    fireEvent.change(screen.getByLabelText('Payeur'), { target: { value: people.alice.id } });
    expect(descriptions()).toEqual(['Courses']);

    fireEvent.change(screen.getByLabelText('Payeur'), { target: { value: people.nicolas.id } });
    expect(screen.getByText('Aucune opération ne correspond à ces filtres.')).toBeTruthy();
  });

  it('trie en cliquant sur les en-têtes', async () => {
    mockAdmin();
    await openTable();
    fireEvent.click(screen.getByRole('button', { name: /^Montant/ }));
    expect(descriptions()).toEqual(['Restaurant', 'Essence', 'Courses']);
    fireEvent.click(screen.getByRole('button', { name: /^Montant/ }));
    expect(descriptions()).toEqual(['Courses', 'Essence', 'Restaurant']);
    expect(screen.getByRole('columnheader', { name: /Montant/ }).getAttribute('aria-sort')).toBe(
      'ascending',
    );
    fireEvent.click(screen.getByRole('button', { name: /^Description/ }));
    expect(descriptions()).toEqual(['Courses', 'Essence', 'Restaurant']);
  });

  it('valide en masse les opérations sélectionnées', async () => {
    const bulkUrl = '/api/v1/transactions/bulk';
    const fetchMock = mockAdmin({
      [bulkUrl]: () => ({ status: 200, body: { transactions: [] } }),
    });
    await openTable();
    fireEvent.change(screen.getByLabelText('Statut'), { target: { value: 'PENDING' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tout sélectionner' }));
    const bar = screen.getByRole('region', { name: 'Actions sur la sélection' });
    expect(within(bar).getByText('2 sélectionnées')).toBeTruthy();
    expect(
      within(bar).getByRole<HTMLButtonElement>('button', { name: 'Annuler les opérations' })
        .disabled,
    ).toBe(true);

    fireEvent.click(within(bar).getByRole('button', { name: 'Valider' }));
    expect(await screen.findByText('2 opérations validées.')).toBeTruthy();
    expect(bodyOf(callsTo(fetchMock, bulkUrl, 'POST')[0]?.[1])).toEqual({
      action: 'validate',
      ids: [fuel.id, groceries.id],
    });
    expect(screen.queryByRole('region', { name: 'Actions sur la sélection' })).toBeNull();
  });

  it('refuse en masse avec un motif, et explique un échec', async () => {
    const bulkUrl = '/api/v1/transactions/bulk';
    const fetchMock = mockAdmin({
      [bulkUrl]: () => ({ status: 409, body: errorBody('INVALID_STATUS_TRANSITION') }),
    });
    await openTable();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sélectionner Essence' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refuser' }));
    fireEvent.change(screen.getByLabelText('Motif (facultatif)'), { target: { value: 'Doublon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer le refus de 1 opération' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/déjà traité/);
    expect(bodyOf(callsTo(fetchMock, bulkUrl, 'POST')[0]?.[1])).toEqual({
      action: 'reject',
      ids: [fuel.id],
      reason: 'Doublon',
    });
  });

  it('modifie la description en ligne (Entrée) en renvoyant toute l’opération', async () => {
    const url = `/api/v1/transactions/${restaurant.id}`;
    const fetchMock = mockAdmin({
      [url]: () => ({ status: 200, body: { ...restaurant, description: 'Pizzeria', version: 3 } }),
    });
    await openTable();
    fireEvent.click(
      screen.getByRole('button', { name: /\(modifier : Description de Restaurant\)$/ }),
    );
    const input = screen.getByRole('textbox', { name: 'Description de Restaurant' });
    fireEvent.change(input, { target: { value: 'Pizzeria' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(callsTo(fetchMock, url, 'PUT')).toHaveLength(1);
    });
    expect(bodyOf(callsTo(fetchMock, url, 'PUT')[0]?.[1])).toEqual({
      amount: 12000,
      description: 'Pizzeria',
      category: 'FOOD',
      occurredOn: '2026-09-28',
      payerId: people.alice.id,
      distribution: { mode: 'EQUAL', participantIds: [people.alice.id, people.bob.id] },
      version: 2,
    });
  });

  it('Échap annule l’édition en ligne sans rien envoyer', async () => {
    const url = `/api/v1/transactions/${restaurant.id}`;
    const fetchMock = mockAdmin();
    await openTable();
    fireEvent.click(
      screen.getByRole('button', { name: /\(modifier : Description de Restaurant\)$/ }),
    );
    const input = screen.getByRole('textbox', { name: 'Description de Restaurant' });
    fireEvent.change(input, { target: { value: 'Autre' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    expect(
      screen.getByRole('button', { name: /\(modifier : Description de Restaurant\)$/ }),
    ).toBeTruthy();
    expect(callsTo(fetchMock, url, 'PUT')).toHaveLength(0);
  });

  it('change la catégorie depuis la liste et signale un conflit de version', async () => {
    const url = `/api/v1/transactions/${fuel.id}`;
    const fetchMock = mockAdmin({
      [url]: () => ({ status: 409, body: errorBody('VERSION_CONFLICT') }),
    });
    await openTable();
    fireEvent.change(screen.getByRole('combobox', { name: 'Catégorie de Essence' }), {
      target: { value: '' },
    });
    expect((await screen.findByRole('alert')).textContent).toMatch(/modifié cette opération/);
    expect(bodyOf(callsTo(fetchMock, url, 'PUT')[0]?.[1])).toMatchObject({ category: null });
  });

  it('n’offre aucune édition sur un nikount clôturé', async () => {
    mockAdmin({}, { ...adminMe, nikount: { ...nikountView, state: 'CLOSED' } });
    await openTable();
    expect(screen.queryByRole('button', { name: /\(modifier : / })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /Catégorie de/ })).toBeNull();
  });

  it('ouvre le détail dans un panneau, puis la modification complète', async () => {
    const url = `/api/v1/transactions/${restaurant.id}`;
    const fetchMock = mockAdmin({
      [url]: (init) =>
        init?.method === 'PUT'
          ? { status: 200, body: { ...restaurant, amount: 9000, version: 3 } }
          : { status: 200, body: restaurant },
      [`${url}/revisions`]: () => ({ status: 200, body: { revisions: [] } }),
    });
    await openTable();
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le détail de Restaurant' }));
    const panel = await screen.findByRole('dialog', { name: 'Détail de Restaurant' });
    fireEvent.click(await within(panel).findByRole('button', { name: '✏️ Modifier' }));

    const editor = screen.getByRole('dialog', { name: 'Modifier Restaurant' });
    const amount = within(editor).getByLabelText<HTMLInputElement>('Montant');
    expect(amount.value).toBe('120,00');
    fireEvent.change(amount, { target: { value: '90' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Enregistrer les modifications' }));

    expect(await screen.findByText('« Restaurant » modifiée.')).toBeTruthy();
    expect(bodyOf(callsTo(fetchMock, url, 'PUT')[0]?.[1])).toMatchObject({
      amount: 9000,
      distribution: { mode: 'EQUAL', participantIds: [people.alice.id, people.bob.id] },
      version: 2,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fermer ✕' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('est réservée aux admins', async () => {
    mockAdmin({}, participantMe);
    const { router } = renderAt(`/n/${PARTICIPANT_TOKEN}/operations`);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/n/${PARTICIPANT_TOKEN}`);
    });
  });
});

describe('barre latérale admin', () => {
  it('mène aux écrans de gestion et compte les opérations à valider', async () => {
    mockAdmin();
    const { router } = renderAt(`/a/${ADMIN_TOKEN}`);
    const nav = await screen.findByRole('navigation', { name: 'Administration' });
    expect((await within(nav).findByRole('link', { name: /À valider/ })).textContent).toContain(
      '2',
    );
    fireEvent.click(within(nav).getByRole('link', { name: /Opérations/ }));
    expect(router.state.location.pathname).toBe(`/a/${ADMIN_TOKEN}/operations`);
    expect(
      within(nav)
        .getByRole('link', { name: /Opérations/ })
        .getAttribute('aria-current'),
    ).toBe('page');
  });

  it('n’existe pas pour un participant', async () => {
    mockAdmin({}, participantMe);
    renderAt(`/n/${PARTICIPANT_TOKEN}`);
    await screen.findByRole('navigation', { name: 'Navigation du nikount' });
    expect(screen.queryByRole('navigation', { name: 'Administration' })).toBeNull();
  });
});
