import { useMutation, useQuery } from '@tanstack/react-query';
import {
  CreateNikountResponse,
  MeResponse,
  ParticipantLinkResponse,
  type CreateNikountRequest,
} from '@nikount/contracts';
import { apiRequest } from './client';

export const nikountKeys = {
  me: (token: string) => ['nikount', token, 'me'] as const,
  participantLink: (token: string) => ['nikount', token, 'participant-link'] as const,
};

export function useCreateNikount() {
  return useMutation({
    mutationFn: (body: CreateNikountRequest) =>
      apiRequest({ path: '/nikounts', method: 'POST', body, schema: CreateNikountResponse }),
  });
}

/** Contexte d'accès du token : rôle, admin éventuel et nikount. */
export function useMe(token: string) {
  return useQuery({
    queryKey: nikountKeys.me(token),
    queryFn: ({ signal }) => apiRequest({ path: '/me', token, schema: MeResponse, signal }),
    retry: false,
  });
}

/** Lien participant à partager (admins uniquement). */
export function useParticipantLink(adminToken: string, enabled: boolean) {
  return useQuery({
    queryKey: nikountKeys.participantLink(adminToken),
    queryFn: ({ signal }) =>
      apiRequest({
        path: '/nikount/participant-link',
        token: adminToken,
        schema: ParticipantLinkResponse,
        signal,
      }),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });
}
