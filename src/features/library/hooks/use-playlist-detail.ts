import { useQuery } from "@tanstack/react-query";

import type { SubsonicClient } from "@/lib/api/subsonic-client";

export function usePlaylistDetail(
  client: SubsonicClient | null,
  sessionKey: string | null,
  playlistId: string | null,
) {
  return useQuery({
    queryKey: ["library", "playlist", playlistId, sessionKey],
    queryFn: async ({ signal }) => {
      if (!client || !playlistId) {
        return null;
      }

      return client.getPlaylist(playlistId, { signal });
    },
    enabled: Boolean(client) && Boolean(playlistId),
    staleTime: 60_000,
  });
}
