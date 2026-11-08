/** Date du jour (AAAA-MM-JJ) dans le fuseau du nikount, pas dans celui de l'appareil. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    // Le format en-CA produit directement AAAA-MM-JJ.
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** « 28/09/2026 20:42 » dans le fuseau du nikount. */
export function formatDateTime(iso: string, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' };
  try {
    return new Intl.DateTimeFormat('fr-FR', { ...options, timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat('fr-FR', options).format(new Date(iso));
  }
}

/** « 28 sept. » pour une date métier AAAA-MM-JJ (sans décalage de fuseau). */
export function formatShortDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)));
}
