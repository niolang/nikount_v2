import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { BalancesResponse } from '@nikount/contracts';
import { getAccess } from '../../auth/access.js';
import type { Database } from '../../db/client.js';
import { getBalances } from './service.js';

export interface BalanceRoutesOptions {
  db: Database;
}

/** Lecture des soldes : ouverte aux participants comme aux admins. */
export const balanceRoutes: FastifyPluginAsyncZod<BalanceRoutesOptions> = async (app, { db }) => {
  app.get('/balances', { schema: { response: { 200: BalancesResponse } } }, async (request) =>
    getBalances(db, getAccess(request).nikountId),
  );
};
