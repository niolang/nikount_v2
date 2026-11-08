import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const share = (participantId: string, amount: number, inputValue: number) => ({
  participantId,
  inputValue,
  amount,
});

// Dépense par parts, dont un participant désactivé depuis (« Ancien »).
const dinner = makeTransaction({
  id: '0193f0aa-0000-7000-8000-000000000d01',
  description: 'Dîner',
  amount: 9000,
  distributionMode: 'SHARES',
  shares: [share(people.alice.id, 6000, 2), share(people.ancien.id, 3000, 1)],
  version: 4,
});
const refund = makeTransaction({
  id: '0193f0aa-0000-7000-8000-000000000d02',
  type: 'REIMBURSEMENT',
  description: 'Virement',
  category: null,
  amount: 2500,
  payerId: people.bob.id,
  shares: [share(people.alice.id, 2500, 1)],
});

const url = (t: { id: string }) => `/api/v1/transactions/${t.id}`;
const bodyOf = (init: RequestInit | undefined) => JSON.parse(init?.body as string) as unknown;

function mockEdit(me: object = adminMe) {
  return mockApi({
    '/api/v1/me': () => ({ status: 200, body: me }),
    '/api/v1/participants': () => ({ status: 200, body: participantList }),
    '/api/v1/balances': () => ({ status: 200, body: zeroBalances }),
    '/api/v1/transactions': () => ({ status: 200, body: { transactions: [dinner, refund] } }),
    [url(dinner)]: (init) =>
      init?.method === 'PUT'
        ? { status: 200, body: { ...dinner, amount: 12000, version: 5 } }
        : { status: 200, body: dinner },
    [`${url(dinner)}/revisions`]: () => ({ status: 200, body: { revisions: [] } }),
    [url(refund)]: (init) =>
      init?.method === 'PUT'
        ? { status: 200, body: { ...refund, amount: 3000, version: 2 } }
        : { status: 200, body: refund },
    [`${url(refund)}/revisions`]: () => ({ status: 200, body: { revisions: [] } }),
  });
}

describe('modifier une opération (mobile)', () => {
  it('le détail propose « Modifier » à un admin', async () => {
    mockEdit();
    const { router } = renderAt(`/a/${ADMIN_TOKEN}/tx/${dinner.id}`);
    fireEvent.click(await screen.findByRole('link', { name: '✏️ Modifier' }));
    expect(router.state.location.pathname).toBe(`/a/${ADMIN_TOKEN}/tx/${dinner.id}/edit`);
  });

  it('… mais pas à un participant, ni sur un nikount clôturé', async () => {
    mockEdit(participantMe);
    renderAt(`/n/${PARTICIPANT_TOKEN}/tx/${dinner.id}`);
    await screen.findByText('Payé par');
    expect(screen.queryByRole('link', { name: '✏️ Modifier' })).toBeNull();
    cleanup();

    mockEdit({ ...adminMe, nikount: { ...nikountView, state: 'CLOSED' } });
    renderAt(`/a/${ADMIN_TOKEN}/tx/${dinner.id}`);
    await screen.findByText('Payé par');
    expect(screen.queryByRole('link', { name: '✏️ Modifier' })).toBeNull();
  });

  it('pré-remplit la dépense (parts, personne désactivée) et envoie la version et le motif', async () => {
    const fetchMock = mockEdit();
    const { router } = renderAt(`/a/${ADMIN_TOKEN}/tx/${dinner.id}/edit`);
    expect(await screen.findByRole('heading', { name: 'Modifier la dépense' })).toBeTruthy();
    const amount = await screen.findByLabelText<HTMLInputElement>('Montant');
    expect(amount.value).toBe('90,00');
    expect(screen.getByLabelText<HTMLInputElement>('Description').value).toBe('Dîner');
    expect(screen.getByRole('button', { name: 'Parts' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText<HTMLInputElement>('Parts pour Alice').value).toBe('2');
    expect(screen.getByLabelText<HTMLInputElement>('Ancien (désactivé)').checked).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>('Bob').checked).toBe(false);

    fireEvent.change(amount, { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('Motif de la modification (facultatif)'), {
      target: { value: 'Ticket corrigé' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les modifications' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/a/${ADMIN_TOKEN}/tx/${dinner.id}`);
    });
    const put = fetchMock.mock.calls.find(
      ([u, init]) => u === url(dinner) && init?.method === 'PUT',
    );
    expect(bodyOf(put?.[1])).toEqual({
      amount: 12000,
      description: 'Dîner',
      category: 'FOOD',
      occurredOn: '2026-09-28',
      payerId: people.alice.id,
      distribution: {
        mode: 'SHARES',
        shares: [
          { participantId: people.alice.id, value: 2 },
          { participantId: people.ancien.id, value: 1 },
        ],
      },
      version: 4,
      reason: 'Ticket corrigé',
    });
  });

  it('modifie un remboursement avec son formulaire', async () => {
    const fetchMock = mockEdit();
    renderAt(`/a/${ADMIN_TOKEN}/tx/${refund.id}/edit`);
    expect(await screen.findByRole('heading', { name: 'Modifier le remboursement' })).toBeTruthy();
    expect((await screen.findByLabelText<HTMLSelectElement>('Qui rembourse ?')).value).toBe(
      people.bob.id,
    );
    expect(screen.getByLabelText<HTMLSelectElement>('À qui ?').value).toBe(people.alice.id);
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les modifications' }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([u, init]) => u === url(refund) && init?.method === 'PUT'),
      ).toBe(true);
    });
    const put = fetchMock.mock.calls.find(
      ([u, init]) => u === url(refund) && init?.method === 'PUT',
    );
    expect(bodyOf(put?.[1])).toMatchObject({
      amount: 3000,
      payerId: people.bob.id,
      distribution: { mode: 'EQUAL', participantIds: [people.alice.id] },
      version: 1,
    });
  });
});
