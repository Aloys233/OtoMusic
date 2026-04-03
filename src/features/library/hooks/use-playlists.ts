import { useQuery } from "@tanstack/react-query";

import type { SubsonicClient } from "@/lib/api/subsonic-client";

export function usePlaylists(client: SubsonicClient | null, sessionKey: string | null) {
  return useQuery({
    queryKey: ["library", "playlists", sessionKey],
    queryFn: async ({ signal }) => {
      if (!client) {
        return [];
      }

      return client.getPlaylists({ signal });
    },
    enabled: Boolean(client),
    staleTime: 60_000,
  });
}
