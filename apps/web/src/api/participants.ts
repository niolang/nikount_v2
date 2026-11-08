import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ParticipantListResponse,
  ParticipantView,
  type UpdateParticipantRequest,
} from '@nikount/contracts';
import { apiRequest } from './client';

export const participantKeys = {
  list: (token: string) => ['nikount', token, 'participants'] as const,
};

/** Tous les participants (actifs et désactivés), dans l'ordre d'affichage. */
export function useParticipants(token: string) {
  return useQuery({
    queryKey: participantKeys.list(token),
    queryFn: ({ signal }) =>
      apiRequest({ path: '/participants', token, schema: ParticipantListResponse, signal }),
    select: (data) => data.participants,
  });
}

export function useCreateParticipant(adminToken: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiRequest({
        path: '/participants',
        method: 'POST',
        token: adminToken,
        body: { name },
        schema: ParticipantView,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: participantKeys.list(adminToken) }),
  });
}

export function useUpdateParticipant(adminToken: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateParticipantRequest & { id: string }) =>
      apiRequest({
        path: `/participants/${id}`,
        method: 'PATCH',
        token: adminToken,
        body,
        schema: ParticipantView,
      }),
    // Succès ou conflit de version : on recharge la liste pour repartir de l'état serveur.
    onSettled: () => queryClient.invalidateQueries({ queryKey: participantKeys.list(adminToken) }),
  });
}
