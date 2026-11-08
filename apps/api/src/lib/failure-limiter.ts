export interface FailureLimiterOptions {
  /** Nombre d'échecs tolérés dans la fenêtre avant blocage. */
  maxFailures: number;
  windowMs: number;
  blockMs: number;
  /** Horloge injectable pour les tests. */
  now?: () => number;
  /** Nombre maximal de clés suivies (protection mémoire). */
  maxEntries?: number;
}

interface Entry {
  failures: number;
  windowStart: number;
  blockedUntil: number;
}

/**
 * Limite les tentatives d'accès avec un token invalide, par adresse IP (anti force brute,
 * docs/security.md §7). En mémoire : suffisant pour une instance unique.
 */
export class FailureLimiter {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(private readonly options: FailureLimiterOptions) {
    this.now = options.now ?? Date.now;
    this.maxEntries = options.maxEntries ?? 10_000;
  }

  isBlocked(key: string): boolean {
    const entry = this.entries.get(key);
    return entry !== undefined && entry.blockedUntil > this.now();
  }

  recordFailure(key: string): void {
    const now = this.now();
    let entry = this.entries.get(key);
    if (!entry || now - entry.windowStart > this.options.windowMs) {
      if (!entry && this.entries.size >= this.maxEntries) this.prune(now);
      entry = { failures: 0, windowStart: now, blockedUntil: 0 };
      this.entries.set(key, entry);
    }
    entry.failures += 1;
    if (entry.failures >= this.options.maxFailures) {
      entry.blockedUntil = now + this.options.blockMs;
    }
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.blockedUntil <= now && now - entry.windowStart > this.options.windowMs) {
        this.entries.delete(key);
      }
    }
    // Toujours plein (attaque distribuée) : on oublie les plus anciennes entrées.
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
