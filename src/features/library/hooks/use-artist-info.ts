import { useQuery } from "@tanstack/react-query";

import type { SubsonicClient } from "@/lib/api/subsonic-client";

export function useArtistInfo(
  client: SubsonicClient | null,
  sessionKey: string | null,
  artistId: string | undefined,
) {
  return useQuery({
    queryKey: ["library", "artistInfo2", artistId, sessionKey],
    queryFn: async ({ signal }) => {
      if (!client || !artistId) {
        return null;
      }

      return client.getArtistInfo2(artistId, { signal });
    },
    enabled: Boolean(client) && Boolean(artistId),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
