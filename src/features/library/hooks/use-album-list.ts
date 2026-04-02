import { useInfiniteQuery } from "@tanstack/react-query";

import type { SubsonicClient } from "@/lib/api/subsonic-client";

const ALBUM_BATCH_SIZE = 120;
const MAX_ALBUM_BATCH_PAGES = 100;

export function useAlbumList(client: SubsonicClient | null, sessionKey: string | null) {
  return useInfiniteQuery({
    queryKey: ["library", "album-list", "newest", ALBUM_BATCH_SIZE, sessionKey],
    queryFn: async ({ signal, pageParam }) => {
      if (!client) {
        return [];
      }

      const offset = typeof pageParam === "number" ? pageParam : 0;
      return client.getAlbumList2("newest", ALBUM_BATCH_SIZE, offset, { signal });
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (allPages.length >= MAX_ALBUM_BATCH_PAGES) {
        return undefined;
      }

      if (lastPage.length < ALBUM_BATCH_SIZE) {
        return undefined;
      }

      return allPages.length * ALBUM_BATCH_SIZE;
    },
    enabled: Boolean(client),
    staleTime: 60_000,
  });
}
