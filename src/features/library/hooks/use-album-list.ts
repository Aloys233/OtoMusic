import { useQuery } from "@tanstack/react-query";

import type { SubsonicClient } from "@/lib/api/subsonic-client";

export function useAlbumList(client: SubsonicClient | null, sessionKey: string | null) {
  return useQuery({
    queryKey: ["library", "album-list", "newest", sessionKey],
    queryFn: async ({ signal }) => {
      if (!client) {
        return [];
      }

      return client.getAlbumList2("newest", 24, 0, { signal });
    },
    enabled: Boolean(client),
    staleTime: 60_000,
  });
}
