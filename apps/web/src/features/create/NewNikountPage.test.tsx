import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { loadRecentNikounts } from '../../lib/recent-nikounts';
import {
  ADMIN_TOKEN,
  errorBody,
  mockApi,
  nikountView,
  PARTICIPANT_TOKEN,
  renderAt,
} from '../../test/utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const created = {
  nikount: nikountView,
  admin: { id: '0193f0aa-0000-7000-8000-000000000001', label: 'Nicolas', participantId: null },
  participantToken: PARTICIPANT_TOKEN,
  adminToken: ADMIN_TOKEN,
};

/** L'écran de création est chargé à la demande. */
async function formReady() {
  await screen.findByRole('button', { name: 'Créer le nikount' });
}

function fillAndSubmit(name: string, adminLabel: string) {
  fireEvent.change(screen.getByLabelText('Nom de l’événement'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Votre prénom'), { target: { value: adminLabel } });
  fireEvent.click(screen.getByRole('button', { name: 'Créer le nikount' }));
}

describe('création d’un nikount', () => {
  it('valide les champs avant tout appel à l’API', async () => {
    const fetchMock = mockApi({});
    renderAt('/new');
    await formReady();
    fillAndSubmit('   ', '');

    expect(screen.getByText(/Donnez un nom/)).toBeTruthy();
    expect(screen.getByText(/Indiquez votre prénom/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('crée le nikount, affiche les deux liens et mémorise l’accès admin', async () => {
    const fetchMock = mockApi({ '/api/v1/nikounts': () => ({ status: 201, body: created }) });
    const { router } = renderAt('/new');
    await formReady();
    fillAndSubmit('Weekend Chamonix', 'Nicolas');

    expect(await screen.findByText(/est prêt/)).toBeTruthy();
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(init?.body as string)).toEqual({
      name: 'Weekend Chamonix',
      adminLabel: 'Nicolas',
      adminIsParticipant: true,
      participants: [],
    });

    const groupLink = screen.getByLabelText<HTMLInputElement>('Lien du groupe');
    const adminLink = screen.getByLabelText<HTMLInputElement>('Votre lien administrateur');
    expect(groupLink.value).toBe(`${window.location.origin}/n/${PARTICIPANT_TOKEN}`);
    expect(adminLink.value).toBe(`${window.location.origin}/a/${ADMIN_TOKEN}`);

    expect(loadRecentNikounts()).toMatchObject([
      { token: ADMIN_TOKEN, role: 'ADMIN', name: 'Weekend Chamonix' },
    ]);

    // L'ouverture exige de confirmer l'enregistrement du lien admin.
    const open = screen.getByRole<HTMLButtonElement>('button', { name: 'Ouvrir mon nikount' });
    expect(open.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/J’ai enregistré mon lien administrateur/));
    expect(open.disabled).toBe(false);
    fireEvent.click(open);
    expect(router.state.location.pathname).toBe(`/a/${ADMIN_TOKEN}`);
  });

  it('explique la limite de créations', async () => {
    mockApi({ '/api/v1/nikounts': () => ({ status: 429, body: errorBody('RATE_LIMITED') }) });
    renderAt('/new');
    await formReady();
    fillAndSubmit('Weekend', 'Nicolas');

    expect((await screen.findByRole('alert')).textContent).toMatch(/Trop de créations/);
  });

  it('ajoute des participants, refuse les doublons et les envoie avec la création', async () => {
    const fetchMock = mockApi({ '/api/v1/nikounts': () => ({ status: 201, body: created }) });
    renderAt('/new');
    await formReady();

    fireEvent.change(screen.getByLabelText('Nom de l’événement'), { target: { value: 'Weekend' } });
    fireEvent.change(screen.getByLabelText('Votre prénom'), { target: { value: 'Nicolas' } });
    const input = screen.getByLabelText('Participants');
    for (const name of ['Alice', ' Bob ']) {
      fireEvent.change(input, { target: { value: name } });
      fireEvent.keyDown(input, { key: 'Enter' });
    }
    // Doublon avec un participant, puis avec le créateur qui participe.
    fireEvent.change(input, { target: { value: 'alice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter ce participant' }));
    expect(screen.getByText('« alice » est déjà dans la liste.')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'NICOLAS' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('« NICOLAS » est déjà dans la liste.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retirer Alice' }));
    fireEvent.click(screen.getByLabelText('Je participe aussi aux dépenses'));
    fireEvent.click(screen.getByRole('button', { name: 'Créer le nikount' }));

    expect(await screen.findByText(/est prêt/)).toBeTruthy();
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(init?.body as string)).toEqual({
      name: 'Weekend',
      adminLabel: 'Nicolas',
      adminIsParticipant: false,
      participants: ['Bob'],
    });
  });
});
