import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  BulkStatusRequest,
  CreateTransactionRequest,
  StatusChangeRequest,
  TransactionIdParams,
  TransactionListResponse,
  TransactionRevisionListResponse,
  TransactionView,
} from '@nikount/contracts';
import type { StatusAction } from '@nikount/core';
import { getAccess, requireAdmin } from '../../auth/access.js';
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

  app.get(
    '/transactions/:id/revisions',
    { schema: { params: TransactionIdParams, response: { 200: TransactionRevisionListResponse } } },
    async (request) => ({
      revisions: await service.listRevisions(db, getAccess(request).nikountId, request.params.id),
    }),
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

  // --- Changements de statut (admins uniquement) ---------------------------------------------

  const statusRoutes: [string, StatusAction][] = [
    ['validate', 'VALIDATE'],
    ['reject', 'REJECT'],
    ['cancel', 'CANCEL'],
  ];
  for (const [path, action] of statusRoutes) {
    app.post(
      `/transactions/:id/${path}`,
      {
        schema: {
          params: TransactionIdParams,
          body: StatusChangeRequest,
          response: { 200: TransactionView },
        },
      },
      async (request) => {
        const access = requireAdmin(request);
        const [view] = await service.changeStatus(
          db,
          access,
          [request.params.id],
          action,
          request.body,
          { requestId: request.id },
        );
        if (!view) throw new Error('Vue introuvable après changement de statut');
        return view;
      },
    );
  }

  app.post(
    '/transactions/bulk',
    { schema: { body: BulkStatusRequest, response: { 200: TransactionListResponse } } },
    async (request) => {
      const access = requireAdmin(request);
      const action: StatusAction =
        request.body.action === 'validate'
          ? 'VALIDATE'
          : request.body.action === 'reject'
            ? 'REJECT'
            : 'CANCEL';
      return {
        transactions: await service.changeStatus(
          db,
          access,
          request.body.ids,
          action,
          { reason: request.body.reason },
          { requestId: request.id },
        ),
      };
    },
  );
};
