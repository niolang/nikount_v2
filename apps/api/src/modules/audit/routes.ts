import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AuditListResponse, AuditQuery } from '@nikount/contracts';
import { requireAdmin } from '../../auth/access.js';
import type { Database } from '../../db/client.js';
import { listAuditEvents } from './query.js';

export interface AuditRoutesOptions {
  db: Database;
}

/** Journal d'audit : lecture seule, admins uniquement, borné au nikount du lien. */
export const auditRoutes: FastifyPluginAsyncZod<AuditRoutesOptions> = async (app, { db }) => {
  app.get(
    '/audit',
    { schema: { querystring: AuditQuery, response: { 200: AuditListResponse } } },
    async (request) => listAuditEvents(db, requireAdmin(request).nikountId, request.query),
  );
};
