import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  CreateTransactionRequest,
  TransactionIdParams,
  TransactionListResponse,
  TransactionView,
} from '@nikount/contracts';
import { getAccess } from '../../auth/access.js';
import type { Database } from '../../db/client.js';
import * as service from './service.js';

export interface TransactionRoutesOptions {
  db: Database;
}

/** Routes protégées : participants et admins lisent et créent ; le statut dépend du rôle. */
export const transactionRoutes: FastifyPluginAsyncZod<TransactionRoutesOptions> = async (
  app,
  { db },
) => {
  app.get(
    '/transactions',
    { schema: { response: { 200: TransactionListResponse } } },
    async (request) => ({
      transactions: await service.listTransactions(db, getAccess(request).nikountId),
    }),
  );

  app.get(
    '/transactions/:id',
    { schema: { params: TransactionIdParams, response: { 200: TransactionView } } },
    async (request) => service.getTransaction(db, getAccess(request).nikountId, request.params.id),
  );

  app.post(
    '/transactions',
    {
      schema: {
        body: CreateTransactionRequest,
        response: { 200: TransactionView, 201: TransactionView },
      },
    },
    async (request, reply) => {
      const { created, transaction } = await service.createTransaction(
        db,
        getAccess(request),
        request.body,
        { requestId: request.id },
      );
      // 201 : créée ; 200 : renvoi d'une saisie déjà enregistrée (idempotence).
      return reply.code(created ? 201 : 200).send(transaction);
    },
  );
};
