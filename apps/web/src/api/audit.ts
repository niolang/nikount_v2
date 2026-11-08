import { useInfiniteQuery } from '@tanstack/react-query';
import { AuditListResponse } from '@nikount/contracts';
import { apiRequest } from './client';

export const auditKeys = {
  all: (token: string) => ['nikount', token, 'audit'] as const,
  list: (token: string, action: string | null) => [...auditKeys.all(token), action] as const,
};

/** Journal d'audit (admin), du plus récent au plus ancien, page par page. */
export function useAudit(adminToken: string, action: string | null) {
  return useInfiniteQuery({
    queryKey: auditKeys.list(adminToken, action),
    initialPageParam: null as number | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      if (action) params.set('action', action);
      if (pageParam !== null) params.set('before', String(pageParam));
      const query = params.size > 0 ? `?${params.toString()}` : '';
      return apiRequest({
        path: `/audit${query}`,
        token: adminToken,
        schema: AuditListResponse,
        signal,
      });
    },
    getNextPageParam: (last) => last.nextBefore,
  });
}
