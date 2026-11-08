import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TransactionListResponse,
  TransactionView,
  type CreateTransactionRequest,
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
