import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { TrackInfo } from "@/stores/player-store";

const MAX_RECENT_PLAYS = 500;
const DUPLICATE_WINDOW_MS = 15_000;

export type RecentPlayEntry = {
  sessionKey: string;
  trackId: string;
  title: string;
  artist: string;
  album?: string;
  albumId?: string;
  coverArtId?: string;
  coverUrl?: string;
  playedAt: number;
};

type RecentPlayState = {
  recentPlays: RecentPlayEntry[];
  recordPlay: (sessionKey: string, track: TrackInfo) => void;
  clearSessionPlays: (sessionKey: string) => void;
};

export const useRecentPlayStore = create<RecentPlayState>()(
  persist(
    (set) => ({
      recentPlays: [],
      recordPlay: (sessionKey, track) => {
        const normalizedSessionKey = sessionKey.trim();
        if (!normalizedSessionKey || !track.id) {
          return;
        }

        const now = Date.now();

        set((state) => {
          const latest = state.recentPlays[0];
          if (
            latest &&
            latest.sessionKey === normalizedSessionKey &&
            latest.trackId === track.id &&
            latest.albumId === track.albumId &&
            now - latest.playedAt < DUPLICATE_WINDOW_MS
          ) {
            return state;
          }

          const entry: RecentPlayEntry = {
            sessionKey: normalizedSessionKey,
            trackId: track.id,
            title: track.title,
            artist: track.artist,
            album: track.album,
            albumId: track.albumId,
            coverArtId: track.coverArtId,
            coverUrl: track.coverUrl,
            playedAt: now,
          };

          return {
            recentPlays: [entry, ...state.recentPlays].slice(0, MAX_RECENT_PLAYS),
          };
        });
      },
      clearSessionPlays: (sessionKey) => {
        const normalizedSessionKey = sessionKey.trim();
        if (!normalizedSessionKey) {
          return;
        }

        set((state) => ({
          recentPlays: state.recentPlays.filter((entry) => entry.sessionKey !== normalizedSessionKey),
        }));
      },
    }),
    {
      name: "otomusic-recent-plays",
      partialize: (state) => ({
        recentPlays: state.recentPlays,
      }),
    },
  ),
);
