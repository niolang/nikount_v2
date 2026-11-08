import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { loadRecentNikounts, rememberNikount } from '../../lib/recent-nikounts';
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

const authHeader = (init: RequestInit | undefined) =>
  (init?.headers as Record<string, string> | undefined)?.['authorization'];

describe('accès participant /n/:token', () => {
  it('affiche le nikount, envoie le token en en-tête et le mémorise', async () => {
    const fetchMock = mockApi({
      '/api/v1/me': () => ({
        status: 200,
        body: { role: 'PARTICIPANT', admin: null, nikount: nikountView },
      }),
    });
    renderAt(`/n/${PARTICIPANT_TOKEN}`);

    expect(await screen.findByRole('heading', { name: 'Weekend Chamonix' })).toBeTruthy();
    expect(screen.getByText('En cours')).toBeTruthy();
    expect(screen.queryByText(/Inviter le groupe/)).toBeNull();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/v1/me');
    expect(authHeader(init)).toBe(`Bearer ${PARTICIPANT_TOKEN}`);
    expect(loadRecentNikounts()).toMatchObject([{ token: PARTICIPANT_TOKEN, role: 'PARTICIPANT' }]);
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
  it('affiche l’admin et le lien du groupe à partager', async () => {
    mockApi({
      '/api/v1/me': () => ({
        status: 200,
        body: {
          role: 'ADMIN',
          admin: { id: '0193f0aa-0000-7000-8000-000000000001', label: 'Nicolas' },
          nikount: nikountView,
        },
      }),
      '/api/v1/nikount/participant-link': (init) => {
        expect(authHeader(init)).toBe(`Bearer ${ADMIN_TOKEN}`);
        return { status: 200, body: { participantToken: PARTICIPANT_TOKEN } };
      },
    });
    renderAt(`/a/${ADMIN_TOKEN}`);

    expect(await screen.findByText('Administrateur · Nicolas')).toBeTruthy();
    const link = await screen.findByLabelText<HTMLInputElement>('Lien du groupe');
    expect(link.value).toBe(`${window.location.origin}/n/${PARTICIPANT_TOKEN}`);
  });
});
