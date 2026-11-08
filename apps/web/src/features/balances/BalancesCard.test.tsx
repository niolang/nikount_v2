import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { BalancesResponse } from '@nikount/contracts';
import { people } from '../../test/utils';
import { BalancesCard } from './BalancesCard';

afterEach(cleanup);

const plain = (value: string | null) => (value ?? '').replace(/[\u00a0\u202f]/g, ' ');
const participants = Object.values(people);

function renderCard(
  balances: BalancesResponse,
  currentId: string | null = people.bob.id,
  state: 'OPEN' | 'SETTLEMENT' = 'OPEN',
) {
  return render(
    <BalancesCard
      balances={balances}
      participants={participants}
      currentId={currentId}
      currency="EUR"
      state={state}
    />,
  );
}

const sample: BalancesResponse = {
  balances: [
    { participantId: people.nicolas.id, balance: 12450 },
    { participantId: people.alice.id, balance: -8250 },
    { participantId: people.bob.id, balance: -4250 },
    { participantId: people.ancien.id, balance: 50 },
  ],
  nextPayerId: people.alice.id,
  settlementSuggestions: [
    { from: people.alice.id, to: people.nicolas.id, amount: 8250 },
    { from: people.bob.id, to: people.nicolas.id, amount: 4200 },
    { from: people.bob.id, to: people.ancien.id, amount: 50 },
  ],
  pending: { count: 2, amount: 4500 },
};

describe('BalancesCard', () => {
  it('affiche « ton solde » de la personne identifiée', () => {
    renderCard(sample);
    expect(plain(screen.getByTestId('my-balance').textContent)).toBe('-42,50 €');
    expect(screen.getByText('à payer')).toBeTruthy();
  });

  it('sépare « à recevoir » et « à payer », triés par montant', () => {
    renderCard(sample);
    const receive = within(screen.getByRole('region', { name: 'À recevoir' }));
    expect(receive.getAllByRole('listitem').map((li) => plain(li.textContent))).toEqual([
      'Nicolas+124,50 €',
      'Ancien (désactivé)+0,50 €',
    ]);
    const pay = within(screen.getByRole('region', { name: 'À payer' }));
    expect(pay.getAllByRole('listitem').map((li) => plain(li.textContent))).toEqual([
      'Alice-82,50 €',
      'Bob (vous)-42,50 €',
    ]);
  });

  it('suggère qui paie la prochaine et signale les opérations en attente', () => {
    renderCard(sample);
    expect(plain(screen.getByText(/Qui paie la prochaine/).textContent)).toBe(
      'Qui paie la prochaine ? → Alice',
    );
    expect(plain(screen.getByText(/en attente/).textContent)).toContain(
      '2 opérations en attente (45,00 €)',
    );
  });

  it('liste les virements suggérés, repliés tant que le nikount est en cours', () => {
    const { container } = renderCard(sample);
    const details = container.querySelector('details');
    expect(details?.open).toBe(false);
    expect(plain(screen.getByText(/Comment tout solder/).textContent)).toContain('3 virements');
    expect(plain(screen.getByText('Alice → Nicolas').parentElement?.textContent ?? null)).toBe(
      'Alice → Nicolas82,50 €',
    );
  });

  it('déplie les virements en phase de règlement', () => {
    const { container } = renderCard(sample, people.bob.id, 'SETTLEMENT');
    expect(container.querySelector('details')?.open).toBe(true);
  });

  it('sans identité : pas de « ton solde »', () => {
    renderCard(sample, null);
    expect(screen.queryByTestId('my-balance')).toBeNull();
  });

  it('tout le monde à l’équilibre', () => {
    renderCard({
      balances: participants.map((p) => ({ participantId: p.id, balance: 0 })),
      nextPayerId: null,
      settlementSuggestions: [],
      pending: { count: 0, amount: 0 },
    });
    expect(screen.getByText(/Tout le monde est à l’équilibre/)).toBeTruthy();
    expect(screen.getByText('à l’équilibre')).toBeTruthy();
    expect(screen.queryByText(/Qui paie/)).toBeNull();
    expect(screen.queryByText(/Comment tout solder/)).toBeNull();
  });
});
