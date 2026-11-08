import type { z } from 'zod';
import { ErrorResponse } from '@nikount/contracts';

/** Erreur renvoyée par l'API, au format standard (docs/api.md §1). */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

export interface ApiRequest<T> {
  path: `/${string}`;
  schema: z.ZodType<T>;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  body?: unknown;
  /** Token d'accès au nikount, envoyé uniquement dans l'en-tête Authorization. */
  token?: string;
  /** Statuts non-2xx dont le corps est une réponse valide (ex. 503 de /health). */
  acceptStatuses?: number[];
  signal?: AbortSignal;
}

/** Appel typé à l'API : la réponse est validée par le schéma Zod du contrat partagé. */
export async function apiRequest<T>(request: ApiRequest<T>): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (request.body !== undefined) headers['content-type'] = 'application/json';
  if (request.token) headers['authorization'] = `Bearer ${request.token}`;

  const init: RequestInit = { method: request.method ?? 'GET', headers, credentials: 'omit' };
  if (request.body !== undefined) init.body = JSON.stringify(request.body);
  if (request.signal) init.signal = request.signal;

  const response = await fetch(`/api/v1${request.path}`, init);
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok && !request.acceptStatuses?.includes(response.status)) {
    const parsed = ErrorResponse.safeParse(payload);
    if (parsed.success) {
      const { code, message } = parsed.data.error;
      throw new ApiError(response.status, code, message, parsed.data.requestId);
    }
    throw new ApiError(response.status, 'HTTP_ERROR', `Erreur HTTP ${String(response.status)}`);
  }

  return request.schema.parse(payload);
}
