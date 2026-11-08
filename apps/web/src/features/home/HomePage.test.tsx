import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { rememberNikount } from '../../lib/recent-nikounts';
import { ADMIN_TOKEN, mockApi, PARTICIPANT_TOKEN, renderAt } from '../../test/utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('page d’accueil', () => {
  it('affiche le service opérationnel quand l’API répond', async () => {
    const fetchMock = mockApi({
      '/api/v1/health': () => ({ status: 200, body: { status: 'ok', database: 'up' } }),
    });
    renderAt('/');

    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('dépenses du groupe');
    expect(await screen.findByText('Service opérationnel')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/health',
      expect.objectContaining({ credentials: 'omit' }),
    );
  });

  it('affiche le service indisponible quand la base est en panne (503)', async () => {
    mockApi({
      '/api/v1/health': () => ({ status: 503, body: { status: 'degraded', database: 'down' } }),
    });
    renderAt('/');

    expect(await screen.findByText('Service indisponible')).toBeTruthy();
  });

  it('mène à la création d’un nikount', () => {
    mockApi({});
    renderAt('/');
    expect(screen.getByRole('link', { name: 'Créer un nikount' }).getAttribute('href')).toBe(
      '/new',
    );
  });

  it('liste « Mes nikounts » avec le bon lien selon le rôle, et permet d’en oublier un', () => {
    mockApi({});
    rememberNikount({ token: PARTICIPANT_TOKEN, role: 'PARTICIPANT', name: 'Rando' });
    rememberNikount({ token: ADMIN_TOKEN, role: 'ADMIN', name: 'Chamonix' });
    renderAt('/');

    expect(screen.getByRole('link', { name: /Chamonix/ }).getAttribute('href')).toBe(
      `/a/${ADMIN_TOKEN}`,
    );
    expect(screen.getByRole('link', { name: /Rando/ }).getAttribute('href')).toBe(
      `/n/${PARTICIPANT_TOKEN}`,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Oublier Rando sur cet appareil' }));
    expect(screen.queryByRole('link', { name: /Rando/ })).toBeNull();
  });
});

describe('route inconnue', () => {
  it('affiche la page introuvable', () => {
    mockApi({});
    renderAt('/inconnu');
    expect(screen.getByRole('heading', { name: 'Page introuvable' })).toBeTruthy();
  });
});
