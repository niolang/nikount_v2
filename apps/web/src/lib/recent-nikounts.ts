import { tokenRole, type AccessRole } from '@nikount/contracts';

/**
 * « Mes nikounts » : liste locale des nikounts ouverts sur cet appareil (docs/architecture.md §5).
 * Seul état persisté côté navigateur. Le stockage peut être indisponible (navigation privée,
 * données bloquées) : chaque accès est protégé et l'application fonctionne sans.
 */
export interface RecentNikount {
  token: string;
  role: AccessRole;
  name: string;
  /** Horodatage ISO du dernier accès. */
  openedAt: string;
}

const STORAGE_KEY = 'nikount.recent.v1';
const MAX_ENTRIES = 20;

function isRecentNikount(value: unknown): value is RecentNikount {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry['token'] === 'string' &&
    typeof entry['name'] === 'string' &&
    typeof entry['openedAt'] === 'string' &&
    tokenRole(entry['token']) !== null &&
    tokenRole(entry['token']) === entry['role']
  );
}

export function loadRecentNikounts(): RecentNikount[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isRecentNikount) : [];
  } catch {
    return [];
  }
}

function save(entries: RecentNikount[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // Stockage indisponible : la liste ne sera simplement pas mémorisée.
  }
}

/** Ajoute ou remonte un nikount en tête de liste. */
export function rememberNikount(entry: Omit<RecentNikount, 'openedAt'>, now = new Date()): void {
  const others = loadRecentNikounts().filter((existing) => existing.token !== entry.token);
  save([{ ...entry, openedAt: now.toISOString() }, ...others]);
}

export function forgetNikount(token: string): void {
  save(loadRecentNikounts().filter((entry) => entry.token !== token));
}
