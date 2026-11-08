/**
 * Drizzle enveloppe les erreurs du driver : le code SQLSTATE PostgreSQL est sur l'erreur
 * elle-même ou sur sa `cause` selon le driver (node-postgres, PGlite).
 */
function pgError(error: unknown): { code?: string; constraint?: string; message?: string } | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === 'string') return error;
  return candidate.cause ? pgError(candidate.cause) : null;
}

/** Violation d'unicité (23505), éventuellement sur une contrainte ou un index précis. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const pg = pgError(error);
  if (pg?.code !== '23505') return false;
  return (
    constraint === undefined ||
    pg.constraint === constraint ||
    Boolean(pg.message?.includes(constraint))
  );
}
