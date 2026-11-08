export interface RequestLimiterOptions {
  /** Requêtes autorisées par clé dans une fenêtre. */
  max: number;
  windowMs: number;
  /** Horloge injectable pour les tests. */
  now?: () => number;
  /** Nombre maximal de clés suivies (protection mémoire). */
  maxEntries?: number;
}

interface Window {
  count: number;
  start: number;
}

/**
 * Compteur à fenêtre fixe par clé (ici : par lien d'accès), en mémoire.
 * Suffisant pour une instance unique (docs/security.md §7).
 */
export class RequestLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(private readonly options: RequestLimiterOptions) {
    this.now = options.now ?? Date.now;
    this.maxEntries = options.maxEntries ?? 10_000;
  }

  /** Compte une requête ; renvoie `false` si la limite de la fenêtre est dépassée. */
  hit(key: string): boolean {
    const now = this.now();
    let window = this.windows.get(key);
    if (!window || now - window.start >= this.options.windowMs) {
      if (!window && this.windows.size >= this.maxEntries) this.prune(now);
      window = { count: 0, start: now };
      this.windows.set(key, window);
    }
    window.count += 1;
    return window.count <= this.options.max;
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.start >= this.options.windowMs) this.windows.delete(key);
    }
    while (this.windows.size >= this.maxEntries) {
      const oldest = this.windows.keys().next().value;
      if (oldest === undefined) break;
      this.windows.delete(oldest);
    }
  }
}
