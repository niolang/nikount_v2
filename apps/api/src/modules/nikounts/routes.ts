import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  AdminIdParams,
  AdminListItem,
  AdminListResponse,
  ChangeNikountStateRequest,
  CreateAdminRequest,
  CreateAdminResponse,
  CreateNikountRequest,
  CreateNikountResponse,
  MeResponse,
  NikountView,
  ParticipantLinkResponse,
  UpdateNikountRequest,
} from '@nikount/contracts';
import { getAccess, requireAdmin } from '../../auth/access.js';
import type { Database } from '../../db/client.js';
import type { SecretBox } from '../../lib/secret-box.js';
import * as repo from './repository.js';
import * as service from './service.js';

export interface NikountRoutesOptions {
  db: Database;
  secretBox: SecretBox;
  createPerHour: number;
}

/** Routes publiques : création d'un nikount (limitée par IP). */
export const publicNikountRoutes: FastifyPluginAsyncZod<NikountRoutesOptions> = async (
  app,
  { db, secretBox, createPerHour },
) => {
  app.post(
    '/nikounts',
    {
      schema: { body: CreateNikountRequest, response: { 201: CreateNikountResponse } },
      config: { rateLimit: { max: createPerHour, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      const created = await service.createNikount(db, secretBox, request.body, {
        requestId: request.id,
      });
      return reply.code(201).send(created);
    },
  );
};

/** Routes protégées : le contexte d'accès est déjà résolu par le hook d'authentification. */
export const protectedNikountRoutes: FastifyPluginAsyncZod<NikountRoutesOptions> = async (
  app,
  { db, secretBox },
) => {
  app.get('/me', { schema: { response: { 200: MeResponse } } }, async (request) => {
    const access = getAccess(request);
    const nikount = await service.getNikount(db, access.nikountId);
    const admin = access.adminId
      ? await repo.findAdminAccess(db, access.nikountId, access.adminId)
      : null;
    return {
      role: access.role,
      admin: admin ? service.toAdminView(admin) : null,
      nikount: service.toNikountView(nikount),
    };
  });

  app.get('/nikount', { schema: { response: { 200: NikountView } } }, async (request) => {
    const access = getAccess(request);
    return service.toNikountView(await service.getNikount(db, access.nikountId));
  });

  app.get(
    '/nikount/participant-link',
    { schema: { response: { 200: ParticipantLinkResponse } } },
    async (request) => {
      const access = requireAdmin(request);
      return {
        participantToken: await service.getParticipantToken(db, secretBox, access.nikountId),
      };
    },
  );

  app.patch(
    '/nikount',
    { schema: { body: UpdateNikountRequest, response: { 200: NikountView } } },
    async (request) =>
      service.renameNikount(db, requireAdmin(request), request.body, { requestId: request.id }),
  );

  app.post(
    '/nikount/state',
    { schema: { body: ChangeNikountStateRequest, response: { 200: NikountView } } },
    async (request) =>
      service.changeState(db, requireAdmin(request), request.body, { requestId: request.id }),
  );

  app.post(
    '/nikount/participant-link/rotate',
    { schema: { response: { 200: ParticipantLinkResponse } } },
    async (request) => ({
      participantToken: await service.rotateParticipantLink(db, secretBox, requireAdmin(request), {
        requestId: request.id,
      }),
    }),
  );

  app.get('/admins', { schema: { response: { 200: AdminListResponse } } }, async (request) => ({
    admins: await service.listAdmins(db, requireAdmin(request)),
  }));

  app.post(
    '/admins',
    { schema: { body: CreateAdminRequest, response: { 201: CreateAdminResponse } } },
    async (request, reply) => {
      const created = await service.createAdmin(db, requireAdmin(request), request.body, {
        requestId: request.id,
      });
      return reply.code(201).send(created);
    },
  );

  app.post(
    '/admins/:id/revoke',
    { schema: { params: AdminIdParams, response: { 200: AdminListItem } } },
    async (request) =>
      service.revokeAdmin(db, requireAdmin(request), request.params.id, {
        requestId: request.id,
      }),
  );
};
