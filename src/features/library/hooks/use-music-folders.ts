import { useQuery } from "@tanstack/react-query";

import type { SubsonicClient } from "@/lib/api/subsonic-client";

export function useMusicFolders(client: SubsonicClient | null, sessionKey: string | null) {
  return useQuery({
    queryKey: ["library", "music-folders", sessionKey],
    queryFn: async ({ signal }) => {
      if (!client) {
        return [];
      }

      return client.getMusicFolders({ signal });
    },
    enabled: Boolean(client),
    staleTime: 60_000,
  });
}
