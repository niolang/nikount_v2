import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { getDeclaredIdentity, setDeclaredIdentity } from '../../lib/identity';
import { loadRecentNikounts, rememberNikount } from '../../lib/recent-nikounts';
import {
  ADMIN_TOKEN,
  adminMe,
  errorBody,
  mockApi,
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

const authHeader = (init: RequestInit | undefined) =>
  (init?.headers as Record<string, string> | undefined)?.['authorization'];

describe('accès participant /n/:token', () => {
  it('demande « Qui êtes-vous ? » au premier accès, puis mémorise le choix', async () => {
    const fetchMock = mockApi({
      '/api/v1/me': () => ({ status: 200, body: participantMe }),
      '/api/v1/participants': () => ({ status: 200, body: participantList }),
    });
    renderAt(`/n/${PARTICIPANT_TOKEN}`);

    expect(await screen.findByRole('heading', { name: 'Weekend Chamonix' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Qui êtes-vous ?' })).toBeTruthy();
    // Les participants désactivés ne sont pas proposés.
    expect(screen.queryByRole('button', { name: 'Ancien' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Bob' }));

    expect(screen.getByText('Bob', { selector: 'strong' })).toBeTruthy();
    expect(screen.getByText('Bob (vous)')).toBeTruthy();
    expect(getDeclaredIdentity(PARTICIPANT_TOKEN)).toBe(people.bob.id);
    expect(screen.queryByText('Gérer')).toBeNull();
    expect(screen.queryByText(/Inviter le groupe/)).toBeNull();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/v1/me');
    expect(authHeader(init)).toBe(`Bearer ${PARTICIPANT_TOKEN}`);
    expect(loadRecentNikounts()).toMatchObject([{ token: PARTICIPANT_TOKEN, role: 'PARTICIPANT' }]);
  });

  it('reprend l’identité mémorisée et permet d’en changer', async () => {
    setDeclaredIdentity(PARTICIPANT_TOKEN, people.alice.id);
    mockApi({
      '/api/v1/me': () => ({ status: 200, body: participantMe }),
      '/api/v1/participants': () => ({ status: 200, body: participantList }),
    });
    renderAt(`/n/${PARTICIPANT_TOKEN}`);

    expect(await screen.findByText('Alice (vous)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'changer' }));
    expect(screen.getByRole('heading', { name: 'Qui êtes-vous ?' })).toBeTruthy();
    expect(getDeclaredIdentity(PARTICIPANT_TOKEN)).toBeNull();
  });

  it('redemande l’identité si le participant mémorisé a été désactivé', async () => {
    setDeclaredIdentity(PARTICIPANT_TOKEN, people.ancien.id);
    mockApi({
      '/api/v1/me': () => ({ status: 200, body: participantMe }),
      '/api/v1/participants': () => ({ status: 200, body: participantList }),
    });
    renderAt(`/n/${PARTICIPANT_TOKEN}`);

    expect(await screen.findByRole('heading', { name: 'Qui êtes-vous ?' })).toBeTruthy();
  });

  it('n’ouvre pas la page de gestion à un participant', async () => {
    mockApi({
      '/api/v1/me': () => ({ status: 200, body: participantMe }),
      '/api/v1/participants': () => ({ status: 200, body: participantList }),
    });
    const { router } = renderAt(`/n/${PARTICIPANT_TOKEN}/participants`);

    expect(await screen.findByRole('heading', { name: 'Qui êtes-vous ?' })).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/n/${PARTICIPANT_TOKEN}`);
  });

  it('rejette sans appel réseau un lien au format invalide', () => {
    const fetchMock = mockApi({});
    renderAt('/n/pas-un-token');
    expect(screen.getByRole('heading', { name: 'Lien invalide' })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejette un token admin présenté sur une URL participant', () => {
    const fetchMock = mockApi({});
    renderAt(`/n/${ADMIN_TOKEN}`);
    expect(screen.getByRole('heading', { name: 'Lien invalide' })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('affiche « lien invalide » sur un 401 et l’oublie sur cet appareil', async () => {
    rememberNikount({ token: PARTICIPANT_TOKEN, role: 'PARTICIPANT', name: 'Ancien' });
    mockApi({ '/api/v1/me': () => ({ status: 401, body: errorBody('INVALID_TOKEN') }) });
    renderAt(`/n/${PARTICIPANT_TOKEN}`);

    expect(await screen.findByRole('heading', { name: 'Lien invalide' })).toBeTruthy();
    expect(loadRecentNikounts()).toEqual([]);
  });
});

describe('accès admin /a/:token', () => {
  it('identifie l’admin par son lien (pas de « Qui êtes-vous ? ») et affiche le lien du groupe', async () => {
    mockApi({
      '/api/v1/me': () => ({ status: 200, body: adminMe }),
      '/api/v1/participants': () => ({ status: 200, body: participantList }),
      '/api/v1/nikount/participant-link': (init) => {
        expect(authHeader(init)).toBe(`Bearer ${ADMIN_TOKEN}`);
        return { status: 200, body: { participantToken: PARTICIPANT_TOKEN } };
      },
    });
    renderAt(`/a/${ADMIN_TOKEN}`);

    expect(await screen.findByText('Administrateur · Nicolas')).toBeTruthy();
    expect(await screen.findByText('Nicolas (vous)')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Qui êtes-vous ?' })).toBeNull();

    const card = screen.getByRole('heading', { name: /Participants \(3\)/ }).closest('section');
    expect(within(card as HTMLElement).queryByText('Ancien')).toBeNull();
    expect(within(card as HTMLElement).getByRole('link', { name: 'Gérer' })).toBeTruthy();

    const link = await screen.findByLabelText<HTMLInputElement>('Lien du groupe');
    expect(link.value).toBe(`${window.location.origin}/n/${PARTICIPANT_TOKEN}`);
  });
});
