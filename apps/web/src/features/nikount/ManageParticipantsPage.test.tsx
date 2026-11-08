import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import {
  ADMIN_TOKEN,
  adminMe,
  errorBody,
  mockApi,
  nikountView,
  participantList,
  people,
  renderAt,
} from '../../test/utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const PAGE = `/a/${ADMIN_TOKEN}/participants`;

function bodyOf(init: RequestInit | undefined): unknown {
  return JSON.parse(init?.body as string);
}

describe('gestion des participants (admin)', () => {
  it('liste tous les participants, désactivés compris', async () => {
    mockApi({
      '/api/v1/me': () => ({ status: 200, body: adminMe }),
      '/api/v1/participants': () => ({ status: 200, body: participantList }),
    });
    renderAt(PAGE);

    expect(await screen.findByRole('heading', { name: 'Participants' })).toBeTruthy();
    expect(await screen.findByText('désactivé')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Réactiver Ancien' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Désactiver Bob' })).toBeTruthy();
  });

  it('ajoute un participant (POST avec le nom normalisé)', async () => {
    const fetchMock = mockApi({
      '/api/v1/me': () => ({ status: 200, body: adminMe }),
      '/api/v1/participants': (init) =>
        init?.method === 'POST'
          ? {
              status: 201,
              body: { ...people.bob, id: people.bob.id.replace(/2$/, '9'), name: 'Charlie' },
            }
          : { status: 200, body: participantList },
    });
    renderAt(PAGE);

    fireEvent.change(await screen.findByLabelText('Ajouter un participant'), {
      target: { value: '  Charlie  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));

    await vi.waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(bodyOf(post?.[1])).toEqual({ name: 'Charlie' });
    });
  });

  it('affiche le refus pour un nom déjà pris', async () => {
    mockApi({
      '/api/v1/me': () => ({ status: 200, body: adminMe }),
      '/api/v1/participants': (init) =>
        init?.method === 'POST'
          ? {
              status: 409,
              body: errorBody('PARTICIPANT_NAME_TAKEN', 'Un participant s’appelle déjà « Bob ».'),
            }
          : { status: 200, body: participantList },
    });
    renderAt(PAGE);

    fireEvent.change(await screen.findByLabelText('Ajouter un participant'), {
      target: { value: 'bob' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));

    expect(await screen.findByText('Un participant s’appelle déjà « Bob ».')).toBeTruthy();
  });

  it('renomme et désactive en envoyant la version courante', async () => {
    const fetchMock = mockApi({
      '/api/v1/me': () => ({ status: 200, body: adminMe }),
      '/api/v1/participants': () => ({ status: 200, body: participantList }),
      [`/api/v1/participants/${people.bob.id}`]: (init) => ({
        status: 200,
        body: { ...people.bob, ...(bodyOf(init) as object), version: 2 },
      }),
    });
    renderAt(PAGE);

    fireEvent.click(await screen.findByRole('button', { name: 'Renommer Bob' }));
    fireEvent.change(screen.getByLabelText('Nouveau nom pour Bob'), { target: { value: 'Bobby' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Désactiver Bob' }));

    await vi.waitFor(() => {
      const patches = fetchMock.mock.calls
        .filter(([, init]) => init?.method === 'PATCH')
        .map(([, init]) => bodyOf(init));
      expect(patches).toEqual([
        { name: 'Bobby', version: 1 },
        { isActive: false, version: 1 },
      ]);
    });
  });

  it('explique un conflit de version', async () => {
    mockApi({
      '/api/v1/me': () => ({ status: 200, body: adminMe }),
      '/api/v1/participants': () => ({ status: 200, body: participantList }),
      [`/api/v1/participants/${people.alice.id}`]: () => ({
        status: 409,
        body: errorBody('VERSION_CONFLICT'),
      }),
    });
    renderAt(PAGE);

    fireEvent.click(await screen.findByRole('button', { name: 'Désactiver Alice' }));
    expect(await screen.findByText(/modifié par quelqu’un d’autre/)).toBeTruthy();
  });

  it('fige la liste quand le nikount est clôturé', async () => {
    mockApi({
      '/api/v1/me': () => ({
        status: 200,
        body: { ...adminMe, nikount: { ...nikountView, state: 'CLOSED' } },
      }),
      '/api/v1/participants': () => ({ status: 200, body: participantList }),
    });
    renderAt(PAGE);

    expect(await screen.findByText(/la liste des participants est figée/)).toBeTruthy();
    expect(screen.queryByLabelText('Ajouter un participant')).toBeNull();
    expect(screen.queryByRole('button', { name: /Désactiver/ })).toBeNull();
  });
});
