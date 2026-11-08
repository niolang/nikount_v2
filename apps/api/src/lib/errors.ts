import type { FastifyError } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import type { ErrorResponse } from '@nikount/contracts';
import type { AppInstance } from './types.js';

/** Erreur métier attendue : son code et son statut HTTP sont exposés au client. */
export class DomainError extends Error {
  override readonly name = 'DomainError';

  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function errorBody(
  requestId: string,
  code: string,
  message: string,
  details?: unknown,
): ErrorResponse {
  return {
    error: details === undefined ? { code, message } : { code, message, details },
    requestId,
  };
}

/** Format d'erreur unique (docs/api.md §1). Les erreurs inattendues ne fuient aucun détail. */
export function registerErrorHandling(app: AppInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply
        .code(400)
        .send(errorBody(request.id, 'VALIDATION_ERROR', 'Données invalides.', error.validation));
    }

    if (error instanceof DomainError) {
      return reply
        .code(error.statusCode)
        .send(errorBody(request.id, error.code, error.message, error.details));
    }

    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      // Erreurs du framework : corps trop gros, JSON invalide, type de contenu…
      return reply.code(status).send(errorBody(request.id, error.code, error.message));
    }

    request.log.error({ err: error }, 'Erreur inattendue');
    return reply.code(500).send(errorBody(request.id, 'INTERNAL_ERROR', 'Erreur interne.'));
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send(errorBody(request.id, 'NOT_FOUND', 'Ressource introuvable.'));
  });
}
