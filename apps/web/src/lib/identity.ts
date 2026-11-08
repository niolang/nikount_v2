/**
 * Identité DÉCLARÉE d'un participant sur cet appareil (« Je suis Bob »), par lien d'accès.
 * Ce n'est jamais une autorisation : elle sert à pré-remplir le payeur et à afficher « vous »
 * (docs/product.md §3). Le stockage peut être indisponible : l'application fonctionne sans.
 */
const STORAGE_KEY = 'nikount.identity.v1';

function load(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
}

function save(identities: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identities));
  } catch {
    // Stockage indisponible : l'identité sera redemandée à la prochaine visite.
  }
}

export function getDeclaredIdentity(token: string): string | null {
  return load()[token] ?? null;
}

export function setDeclaredIdentity(token: string, participantId: string): void {
  save({ ...load(), [token]: participantId });
}

export function clearDeclaredIdentity(token: string): void {
  const { [token]: _removed, ...rest } = load();
  save(rest);
}
