import { z } from 'zod';

/** Format unique des erreurs de l'API (docs/api.md §1). */
export const ErrorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
  requestId: z.string(),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  database: z.enum(['up', 'down']),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
