import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AdminListItem,
  AdminListResponse,
  CreateAdminResponse,
  CreateNikountResponse,
  MeResponse,
  NikountView,
  ParticipantLinkResponse,
  type ChangeNikountStateRequest,
  type CreateAdminRequest,
  type CreateNikountRequest,
  type UpdateNikountRequest,
} from '@nikount/contracts';
import { apiRequest } from './client';

export const nikountKeys = {
  me: (token: string) => ['nikount', token, 'me'] as const,
  participantLink: (token: string) => ['nikount', token, 'participant-link'] as const,
  admins: (token: string) => ['nikount', token, 'admins'] as const,
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

// --- Cycle de vie et paramètres (admin) -----------------------------------

/**
 * Après un changement du nikount : met à jour `/me` sur place puis recharge tout ce qui dépend
 * de l'état (opérations, soldes, participants).
 */
function useNikountUpdated(token: string) {
  const queryClient = useQueryClient();
  return (nikount: NikountView) => {
    queryClient.setQueryData<MeResponse>(nikountKeys.me(token), (me) =>
      me ? { ...me, nikount } : me,
    );
    void queryClient.invalidateQueries({ queryKey: ['nikount', token] });
  };
}

export function useChangeNikountState(adminToken: string) {
  const onUpdated = useNikountUpdated(adminToken);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ChangeNikountStateRequest) =>
      apiRequest({
        path: '/nikount/state',
        method: 'POST',
        token: adminToken,
        body,
        schema: NikountView,
      }),
    onSuccess: onUpdated,
    // Conflit ou état changé ailleurs : on repart de l'état serveur.
    onError: () => queryClient.invalidateQueries({ queryKey: ['nikount', adminToken] }),
  });
}

export function useRenameNikount(adminToken: string) {
  const onUpdated = useNikountUpdated(adminToken);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateNikountRequest) =>
      apiRequest({
        path: '/nikount',
        method: 'PATCH',
        token: adminToken,
        body,
        schema: NikountView,
      }),
    onSuccess: onUpdated,
    onError: () => queryClient.invalidateQueries({ queryKey: nikountKeys.me(adminToken) }),
  });
}

export function useRotateParticipantLink(adminToken: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest({
        path: '/nikount/participant-link/rotate',
        method: 'POST',
        token: adminToken,
        schema: ParticipantLinkResponse,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(nikountKeys.participantLink(adminToken), data);
    },
  });
}

export function useAdmins(adminToken: string) {
  return useQuery({
    queryKey: nikountKeys.admins(adminToken),
    queryFn: ({ signal }) =>
      apiRequest({ path: '/admins', token: adminToken, schema: AdminListResponse, signal }),
    select: (data) => data.admins,
  });
}

export function useCreateAdmin(adminToken: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAdminRequest) =>
      apiRequest({
        path: '/admins',
        method: 'POST',
        token: adminToken,
        body,
        schema: CreateAdminResponse,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: nikountKeys.admins(adminToken) }),
  });
}

export function useRevokeAdmin(adminToken: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (adminId: string) =>
      apiRequest({
        path: `/admins/${adminId}/revoke`,
        method: 'POST',
        token: adminToken,
        schema: AdminListItem,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: nikountKeys.admins(adminToken) }),
  });
}
