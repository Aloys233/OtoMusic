import { useQuery } from "@tanstack/react-query";

import type { SubsonicClient } from "@/lib/api/subsonic-client";

export function useGlobalSearch(
  client: SubsonicClient | null,
  sessionKey: string | null,
  keyword: string,
) {
  const normalizedKeyword = keyword.trim();

  return useQuery({
    queryKey: ["library", "search3", normalizedKeyword, sessionKey],
    queryFn: async () => {
      if (!client || !normalizedKeyword) {
        return { albums: [], songs: [] };
      }

      return client.search3(normalizedKeyword, 80, 40);
    },
    enabled: Boolean(client) && normalizedKeyword.length > 0,
    staleTime: 30_000,
  });
}
