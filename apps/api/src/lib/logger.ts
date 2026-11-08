import type { FastifyServerOptions } from 'fastify';
import type { Config } from '../config.js';

/**
 * Options du logger pino. Les tokens d'accès ne doivent JAMAIS apparaître dans les logs
 * (docs/security.md §2) : l'API ne les reçoit que dans l'en-tête Authorization, masqué ici.
 */
export function loggerOptions(config: Config): NonNullable<FastifyServerOptions['logger']> {
  return {
    level: config.LOG_LEVEL,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'headers.authorization'],
      censor: '[redacted]',
    },
  };
}
