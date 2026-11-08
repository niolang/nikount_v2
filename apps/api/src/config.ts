import { z } from 'zod';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_HOST: z.string().min(1).default('0.0.0.0'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Nombre de reverse proxys de confiance (Caddy = 1). 0 = aucun. */
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    /** URL publique du front, utilisée pour construire les liens de partage. */
    PUBLIC_BASE_URL: z.url({ protocol: /^https?$/ }),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.PUBLIC_BASE_URL.startsWith('https://'), {
    message: 'PUBLIC_BASE_URL doit être en HTTPS en production',
    path: ['PUBLIC_BASE_URL'],
  });

export type Config = z.infer<typeof EnvSchema>;

/** Lit et valide la configuration. Échoue au démarrage plutôt qu'en cours d'exécution. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Configuration invalide :\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
