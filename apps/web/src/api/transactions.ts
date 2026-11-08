import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TransactionListResponse,
  TransactionRevisionListResponse,
  TransactionView,
  type CreateTransactionRequest,
  type UpdateTransactionRequest,
} from '@nikount/contracts';
import { balanceKeys } from './balances';
import { apiRequest } from './client';

export const transactionKeys = {
  list: (token: string) => ['nikount', token, 'transactions'] as const,
};

/** Opérations du nikount, plus récentes d'abord. */
export function useTransactions(token: string) {
  return useQuery({
    queryKey: transactionKeys.list(token),
    queryFn: ({ signal }) =>
      apiRequest({ path: '/transactions', token, schema: TransactionListResponse, signal }),
    select: (data) => data.transactions,
  });
}

export function useTransaction(token: string, transactionId: string) {
  return useQuery({
    queryKey: [...transactionKeys.list(token), transactionId] as const,
    queryFn: ({ signal }) =>
      apiRequest({
        path: `/transactions/${transactionId}`,
        token,
        schema: TransactionView,
        signal,
      }),
    retry: false,
  });
}

export function useTransactionRevisions(token: string, transactionId: string) {
  return useQuery({
    queryKey: [...transactionKeys.list(token), transactionId, 'revisions'] as const,
    queryFn: ({ signal }) =>
      apiRequest({
        path: `/transactions/${transactionId}/revisions`,
        token,
        schema: TransactionRevisionListResponse,
        signal,
      }),
    select: (data) => data.revisions,
    retry: false,
  });
}

export function useCreateTransaction(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTransactionRequest) =>
      apiRequest({
        path: '/transactions',
        method: 'POST',
        token,
        body,
        schema: TransactionView,
      }),
    // Une nouvelle opération peut changer l'historique ET les soldes.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: transactionKeys.list(token) }),
        queryClient.invalidateQueries({ queryKey: balanceKeys.all(token) }),
      ]),
  });
}

export type StatusActionPath = 'validate' | 'reject' | 'cancel';

/** Rafraîchit tout ce qu'un changement de statut peut modifier : historique, détail, soldes. */
function useRefreshAfterStatusChange(token: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: transactionKeys.list(token) }),
      queryClient.invalidateQueries({ queryKey: balanceKeys.all(token) }),
    ]);
}

/** Valider, refuser ou annuler une opération (admin). */
export function useChangeStatus(adminToken: string) {
  const refresh = useRefreshAfterStatusChange(adminToken);
  return useMutation({
    mutationFn: ({
      id,
      action,
      reason,
      version,
    }: {
      id: string;
      action: StatusActionPath;
      reason?: string;
      version?: number;
    }) =>
      apiRequest({
        path: `/transactions/${id}/${action}`,
        method: 'POST',
        token: adminToken,
        body: {
          ...(reason ? { reason } : {}),
          ...(version !== undefined ? { version } : {}),
        },
        schema: TransactionView,
      }),
    // Succès ou conflit : on repart de l'état du serveur.
    onSettled: refresh,
  });
}

/** Action en masse, tout ou rien (admin). */
export function useBulkStatus(adminToken: string) {
  const refresh = useRefreshAfterStatusChange(adminToken);
  return useMutation({
    mutationFn: (body: { action: StatusActionPath; ids: string[]; reason?: string }) =>
      apiRequest({
        path: '/transactions/bulk',
        method: 'POST',
        token: adminToken,
        body,
        schema: TransactionListResponse,
      }),
    onSettled: refresh,
  });
}

/** Modifier le contenu d'une opération (admin) : nouvelle révision, statut inchangé. */
export function useUpdateTransaction(adminToken: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateTransactionRequest }) =>
      apiRequest({
        path: `/transactions/${id}`,
        method: 'PUT',
        token: adminToken,
        body,
        schema: TransactionView,
      }),
    onSuccess: (transaction) => {
      queryClient.setQueryData([...transactionKeys.list(adminToken), transaction.id], transaction);
    },
    // Succès ou conflit : historique, détail, révisions et soldes repartent du serveur.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: transactionKeys.list(adminToken) }),
        queryClient.invalidateQueries({ queryKey: balanceKeys.all(adminToken) }),
        queryClient.invalidateQueries({ queryKey: ['nikount', adminToken, 'audit'] }),
      ]),
  });
}
