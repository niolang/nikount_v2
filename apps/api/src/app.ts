import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Config } from './config.js';
import { registerErrorHandling } from './lib/errors.js';
import { loggerOptions } from './lib/logger.js';
import type { AppInstance } from './lib/types.js';
import { healthRoutes } from './modules/health/routes.js';

export interface AppDependencies {
  config: Config;
  checkDatabase: () => Promise<boolean>;
}

/** Construit l'application sans écouter : utilisée par server.ts et par les tests (inject). */
export async function buildApp(deps: AppDependencies): Promise<AppInstance> {
  const trustedHops = deps.config.TRUST_PROXY;
  const app = Fastify({
    logger: loggerOptions(deps.config),
    // Ne fait confiance qu'aux N proxys les plus proches (Caddy) pour déterminer l'IP cliente.
    trustProxy: trustedHops > 0 ? (_address: string, hop: number) => hop < trustedHops : false,
    bodyLimit: 64 * 1024,
    // L'identifiant de requête est toujours généré par le serveur, jamais repris du client.
    requestIdHeader: false,
    genReqId: () => randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, {
    // L'API ne sert que du JSON : politique la plus stricte possible.
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    referrerPolicy: { policy: 'no-referrer' },
  });

  app.addHook('onSend', async (request, reply) => {
    void reply.header('x-request-id', request.id);
  });

  registerErrorHandling(app);

  await app.register(healthRoutes, { prefix: '/api/v1', checkDatabase: deps.checkDatabase });

  return app;
}
