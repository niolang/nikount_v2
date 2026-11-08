import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { HealthResponse } from '@nikount/contracts';

export interface HealthRoutesOptions {
  checkDatabase: () => Promise<boolean>;
}

export const healthRoutes: FastifyPluginAsyncZod<HealthRoutesOptions> = async (app, options) => {
  app.get(
    '/health',
    { schema: { response: { 200: HealthResponse, 503: HealthResponse } } },
    async (_request, reply) => {
      const up = await options.checkDatabase().catch(() => false);
      return reply
        .code(up ? 200 : 503)
        .send({ status: up ? 'ok' : 'degraded', database: up ? 'up' : 'down' });
    },
  );
};
