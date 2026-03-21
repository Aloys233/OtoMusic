import { useQuery } from "@tanstack/react-query";

import type { SubsonicClient } from "@/lib/api/subsonic-client";

export function useAlbumSongs(
  client: SubsonicClient | null,
  sessionKey: string | null,
  albumId: string | null,
) {
  return useQuery({
    queryKey: ["library", "album", albumId, "songs", sessionKey],
    queryFn: async () => {
      if (!client || !albumId) {
        return [];
      }

      const album = await client.getAlbum(albumId);
      return album.song ?? [];
    },
    enabled: Boolean(client) && Boolean(albumId),
    staleTime: 60_000,
  });
}
