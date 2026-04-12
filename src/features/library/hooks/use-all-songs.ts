import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { SubsonicClient } from "@/lib/api/subsonic-client";
import type { SubsonicSong } from "@/types/subsonic";

const MAX_PARALLEL_ALBUM_REQUESTS = 6;
const SONG_CACHE_STALE_TIME = 5 * 60_000;

function getAlbumSongsQueryKey(albumId: string, sessionKey: string | null) {
  return ["library", "album", albumId, "songs", sessionKey] as const;
}

async function fetchAlbumSongs(client: SubsonicClient, albumId: string, signal?: AbortSignal) {
  const album = await client.getAlbum(albumId, { signal });
  return album.song ?? [];
}

export function useAllSongs(
  client: SubsonicClient | null,
  sessionKey: string | null,
  albumIds: string[],
  catalogReady: boolean,
) {
  const queryClient = useQueryClient();
  const preloadedAlbumIdsRef = useRef(new Set<string>());
  const preloadSessionKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (preloadSessionKeyRef.current !== sessionKey) {
      preloadSessionKeyRef.current = sessionKey;
      preloadedAlbumIdsRef.current = new Set();
    }

    if (!client || !sessionKey || albumIds.length === 0) {
      return;
    }

    const pendingAlbumIds = albumIds.filter((albumId) => !preloadedAlbumIdsRef.current.has(albumId));
    if (pendingAlbumIds.length === 0) {
      return;
    }

    let nextAlbumIndex = 0;
    const workerCount = Math.min(MAX_PARALLEL_ALBUM_REQUESTS, pendingAlbumIds.length);

    void Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextAlbumIndex < pendingAlbumIds.length) {
          const albumId = pendingAlbumIds[nextAlbumIndex];
          nextAlbumIndex += 1;
          preloadedAlbumIdsRef.current.add(albumId);

          await queryClient.prefetchQuery({
            queryKey: getAlbumSongsQueryKey(albumId, sessionKey),
            queryFn: ({ signal }) => fetchAlbumSongs(client, albumId, signal),
            staleTime: SONG_CACHE_STALE_TIME,
          });
        }
      }),
    );
  }, [albumIds, client, queryClient, sessionKey]);

  return useQuery({
    queryKey: ["library", "all-songs", sessionKey, albumIds],
    queryFn: async ({ signal }) => {
      if (!client || albumIds.length === 0) {
        return [];
      }

      const albumSongs: SubsonicSong[][] = Array.from({ length: albumIds.length }, () => []);
      let nextAlbumIndex = 0;
      const workerCount = Math.min(MAX_PARALLEL_ALBUM_REQUESTS, albumIds.length);

      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (nextAlbumIndex < albumIds.length) {
            const currentAlbumIndex = nextAlbumIndex;
            nextAlbumIndex += 1;
            const albumId = albumIds[currentAlbumIndex];
            albumSongs[currentAlbumIndex] = await queryClient.fetchQuery({
              queryKey: getAlbumSongsQueryKey(albumId, sessionKey),
              queryFn: () => fetchAlbumSongs(client, albumId, signal),
              staleTime: SONG_CACHE_STALE_TIME,
            });
          }
        }),
      );

      return albumSongs.flat();
    },
    enabled: Boolean(client) && Boolean(sessionKey) && catalogReady && albumIds.length > 0,
    staleTime: SONG_CACHE_STALE_TIME,
  });
}
