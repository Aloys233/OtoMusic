import { useQuery } from "@tanstack/react-query";

import type { SubsonicClient } from "@/lib/api/subsonic-client";

export function useGenres(client: SubsonicClient | null, sessionKey: string | null) {
  return useQuery({
    queryKey: ["library", "genres", sessionKey],
    queryFn: async ({ signal }) => {
      if (!client) {
        return [];
      }

      return client.getGenres({ signal });
    },
    enabled: Boolean(client),
    staleTime: 60_000,
  });
}
