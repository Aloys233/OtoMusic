import { useQuery } from "@tanstack/react-query";

import type { SubsonicClient } from "@/lib/api/subsonic-client";

export function useLovedTracks(client: SubsonicClient | null, sessionKey: string | null) {
  return useQuery({
    queryKey: ["library", "loved-tracks", sessionKey],
    queryFn: async ({ signal }) => {
      if (!client) {
        return [];
      }

      const { songs } = await client.getStarred2({ signal });
      return songs;
    },
    enabled: Boolean(client),
    staleTime: 60_000,
  });
}
