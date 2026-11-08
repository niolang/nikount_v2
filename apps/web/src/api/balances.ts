import { useQuery } from '@tanstack/react-query';
import { BalancesResponse } from '@nikount/contracts';
import { apiRequest } from './client';

export const balanceKeys = {
  all: (token: string) => ['nikount', token, 'balances'] as const,
};

/** Soldes, « qui paie la prochaine » et virements suggérés. */
export function useBalances(token: string) {
  return useQuery({
    queryKey: balanceKeys.all(token),
    queryFn: ({ signal }) =>
      apiRequest({ path: '/balances', token, schema: BalancesResponse, signal }),
  });
}
