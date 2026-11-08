import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { createAuthenticator } from './auth/access.js';
import type { Config } from './config.js';
import { isDatabaseUp, type Database } from './db/client.js';
import { DomainError, registerErrorHandling } from './lib/errors.js';
import { FailureLimiter } from './lib/failure-limiter.js';
import { RequestLimiter } from './lib/request-limiter.js';
import { loggerOptions } from './lib/logger.js';
import { SecretBox } from './lib/secret-box.js';
import type { AppInstance } from './lib/types.js';
import { healthRoutes } from './modules/health/routes.js';
import { protectedNikountRoutes, publicNikountRoutes } from './modules/nikounts/routes.js';
import { participantRoutes } from './modules/participants/routes.js';
import { transactionRoutes } from './modules/transactions/routes.js';
import { auditRoutes } from './modules/audit/routes.js';
import { balanceRoutes } from './modules/balances/routes.js';

export interface AppDependencies {
  config: Config;
  db: Database;
  /** Surcharge pour les tests ; par défaut, interroge la base. */
  checkDatabase?: () => Promise<boolean>;
  /** Horloge injectable (limiteur d'échecs d'authentification). */
  now?: () => number;
}

const MINUTE = 60_000;

/** Construit l'application sans écouter : utilisée par server.ts et par les tests (inject). */
export async function buildApp(deps: AppDependencies): Promise<AppInstance> {
  const { config, db } = deps;
  const trustedHops = config.TRUST_PROXY;
  const app = Fastify({
    logger: loggerOptions(config),
    // Ne fait confiance qu'aux N proxys les plus proches (Caddy) pour déterminer l'IP cliente.
    trustProxy: trustedHops > 0 ? (_address: string, hop: number) => hop < trustedHops : false,
    bodyLimit: 64 * 1024,
    // L'identifiant de requête est toujours généré par le serveur, jamais repris du client.
    requestIdHeader: false,
    genReqId: () => randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('access', null);

  await app.register(helmet, {
    // L'API ne sert que du JSON : politique la plus stricte possible.
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    referrerPolicy: { policy: 'no-referrer' },
  });

  // Limites activées route par route (config.rateLimit).
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () =>
      new DomainError(429, 'RATE_LIMITED', 'Trop de requêtes. Réessayez plus tard.'),
  });

  app.addHook('onSend', async (request, reply) => {
    void reply.header('x-request-id', request.id);
    // Les réponses de l'API ne doivent jamais être mises en cache (elles dépendent du token).
    void reply.header('cache-control', 'no-store');
  });

  registerErrorHandling(app);

  const secretBox = new SecretBox(config.TOKEN_ENCRYPTION_KEY);
  const failureLimiter = new FailureLimiter({
    maxFailures: config.AUTH_FAILURE_MAX,
    windowMs: config.AUTH_FAILURE_WINDOW_MINUTES * MINUTE,
    blockMs: config.AUTH_FAILURE_BLOCK_MINUTES * MINUTE,
    ...(deps.now ? { now: deps.now } : {}),
  });
  const clock = deps.now ? { now: deps.now } : {};
  const writeLimiter = new RequestLimiter({
    max: config.RATE_LIMIT_WRITES_PER_MINUTE,
    windowMs: MINUTE,
    ...clock,
  });
  const readLimiter = new RequestLimiter({
    max: config.RATE_LIMIT_READS_PER_MINUTE,
    windowMs: MINUTE,
    ...clock,
  });
  const routeOptions = { db, secretBox, createPerHour: config.RATE_LIMIT_CREATE_PER_HOUR };

  await app.register(
    async (api) => {
      await api.register(healthRoutes, {
        checkDatabase: deps.checkDatabase ?? (() => isDatabaseUp(db)),
      });
      await api.register(publicNikountRoutes, routeOptions);

      // Tout ce qui est enregistré ici exige un token valide.
      await api.register(async (protectedApi) => {
        protectedApi.addHook('onRequest', createAuthenticator({ db, failureLimiter }));
        // Limites par lien d'accès. Le lien participant étant partagé par tout le groupe, son
        // compteur est aussi séparé par IP (un groupe entier ne se bloque pas lui-même).
        protectedApi.addHook('onRequest', async (request) => {
          const access = request.access;
          if (!access) return;
          const key = access.adminId
            ? `a:${access.adminId}`
            : `p:${access.nikountId}:${request.ip}`;
          const limiter = request.method === 'GET' ? readLimiter : writeLimiter;
          if (!limiter.hit(key)) {
            throw new DomainError(429, 'RATE_LIMITED', 'Trop de requêtes. Réessayez plus tard.');
          }
        });
        await protectedApi.register(protectedNikountRoutes, routeOptions);
        await protectedApi.register(participantRoutes, { db });
        await protectedApi.register(transactionRoutes, { db });
        await protectedApi.register(balanceRoutes, { db });
        await protectedApi.register(auditRoutes, { db });
      });
    },
    { prefix: '/api/v1' },
  );

  return app;
}
