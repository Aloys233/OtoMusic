import { useQuery } from "@tanstack/react-query";

import type { LyricsData, SubsonicClient } from "@/lib/api/subsonic-client";

type LyricsTarget = {
  title: string;
  artist: string;
} | null;

export function useLyrics(
  client: SubsonicClient | null,
  sessionKey: string | null,
  target: LyricsTarget,
) {
  return useQuery<LyricsData>({
    queryKey: ["library", "lyrics", target?.artist, target?.title, sessionKey],
    queryFn: async () => {
      if (!client || !target) {
        return {
          text: "",
          timedLines: [],
        };
      }

      return client.getLyrics(target.artist, target.title);
    },
    enabled: Boolean(client) && Boolean(target),
    staleTime: 5 * 60_000,
  });
}
