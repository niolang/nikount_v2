import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  CreateParticipantRequest,
  ParticipantIdParams,
  ParticipantListResponse,
  ParticipantView,
  UpdateParticipantRequest,
} from '@nikount/contracts';
import { getAccess, requireAdmin } from '../../auth/access.js';
import type { Database } from '../../db/client.js';
import * as service from './service.js';

export interface ParticipantRoutesOptions {
  db: Database;
}

/** Routes protégées : lecture pour tous, écriture réservée aux admins. */
export const participantRoutes: FastifyPluginAsyncZod<ParticipantRoutesOptions> = async (
  app,
  { db },
) => {
  app.get(
    '/participants',
    { schema: { response: { 200: ParticipantListResponse } } },
    async (request) => ({
      participants: await service.listParticipants(db, getAccess(request).nikountId),
    }),
  );

  app.post(
    '/participants',
    { schema: { body: CreateParticipantRequest, response: { 201: ParticipantView } } },
    async (request, reply) => {
      const access = requireAdmin(request);
      const created = await service.createParticipant(db, access, request.body.name, {
        requestId: request.id,
      });
      return reply.code(201).send(created);
    },
  );

  app.patch(
    '/participants/:id',
    {
      schema: {
        params: ParticipantIdParams,
        body: UpdateParticipantRequest,
        response: { 200: ParticipantView },
      },
    },
    async (request) => {
      const access = requireAdmin(request);
      return service.updateParticipant(db, access, request.params.id, request.body, {
        requestId: request.id,
      });
    },
  );
};
