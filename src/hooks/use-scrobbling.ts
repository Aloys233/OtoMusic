import SparkMD5 from "spark-md5";
import { useEffect, useMemo, useRef } from "react";

import type { TrackInfo } from "@/stores/player-store";
import { usePlayerStore } from "@/stores/player-store";
import { useSettingsStore } from "@/stores/settings-store";

type ListenPayload = {
  track_metadata: {
    artist_name: string;
    track_name: string;
    release_name?: string;
  };
  listened_at?: number;
};

function buildListenPayload(track: TrackInfo, listenedAt?: number): ListenPayload {
  return {
    track_metadata: {
      artist_name: track.artist || "Unknown Artist",
      track_name: track.title || "Unknown Track",
    },
    ...(typeof listenedAt === "number" ? { listened_at: listenedAt } : {}),
  };
}

async function submitListenBrainzNowPlaying(token: string, track: TrackInfo) {
  const payload = {
    listen_type: "playing_now",
    payload: [buildListenPayload(track)],
  };

  await fetch("https://api.listenbrainz.org/1/submit-listens", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${token}`,
    },
    body: JSON.stringify(payload),
  });
}

async function submitListenBrainzScrobble(token: string, track: TrackInfo) {
  const payload = {
    listen_type: "single",
    payload: [buildListenPayload(track, Math.floor(Date.now() / 1000))],
  };

  await fetch("https://api.listenbrainz.org/1/submit-listens", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${token}`,
    },
    body: JSON.stringify(payload),
  });
}

function createLastFmSignature(params: Record<string, string>, apiSecret: string) {
  const signatureBase = Object.entries(params)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}${value}`)
    .join("");
  return SparkMD5.hash(`${signatureBase}${apiSecret}`);
}

async function submitLastFmMethod(
  method: "track.updateNowPlaying" | "track.scrobble",
  data: {
    track: TrackInfo;
    apiKey: string;
    apiSecret: string;
    sessionKey: string;
  },
) {
  const params: Record<string, string> = {
    method,
    api_key: data.apiKey,
    sk: data.sessionKey,
    artist: data.track.artist || "Unknown Artist",
    track: data.track.title || "Unknown Track",
    format: "json",
  };

  if (method === "track.scrobble") {
    params.timestamp = String(Math.floor(Date.now() / 1000));
  }

  params.api_sig = createLastFmSignature(params, data.apiSecret);

  const searchParams = new URLSearchParams(params);
  await fetch("https://ws.audioscrobbler.com/2.0/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: searchParams.toString(),
  });
}

export function useScrobbling(currentTrack: TrackInfo | null) {
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const progress = usePlayerStore((state) => state.progress);
  const scrobbleProvider = useSettingsStore((state) => state.scrobbleProvider);
  const listenBrainzToken = useSettingsStore((state) => state.listenBrainzToken);
  const lastFmApiKey = useSettingsStore((state) => state.lastFmApiKey);
  const lastFmApiSecret = useSettingsStore((state) => state.lastFmApiSecret);
  const lastFmSessionKey = useSettingsStore((state) => state.lastFmSessionKey);

  const nowPlayingSentRef = useRef<Set<string>>(new Set());
  const scrobbledRef = useRef<Set<string>>(new Set());

  const canScrobble = useMemo(() => {
    if (scrobbleProvider === "listenbrainz") {
      return Boolean(listenBrainzToken.trim());
    }

    if (scrobbleProvider === "lastfm") {
      return Boolean(lastFmApiKey && lastFmApiSecret && lastFmSessionKey);
    }

    return false;
  }, [lastFmApiKey, lastFmApiSecret, lastFmSessionKey, listenBrainzToken, scrobbleProvider]);

  useEffect(() => {
    if (!currentTrack || !isPlaying || !canScrobble) {
      return;
    }

    if (nowPlayingSentRef.current.has(currentTrack.id)) {
      return;
    }

    nowPlayingSentRef.current.add(currentTrack.id);

    const submitNowPlaying = async () => {
      try {
        if (scrobbleProvider === "listenbrainz") {
          await submitListenBrainzNowPlaying(listenBrainzToken, currentTrack);
          return;
        }

        if (scrobbleProvider === "lastfm") {
          await submitLastFmMethod("track.updateNowPlaying", {
            track: currentTrack,
            apiKey: lastFmApiKey,
            apiSecret: lastFmApiSecret,
            sessionKey: lastFmSessionKey,
          });
        }
      } catch (error) {
        console.warn("[Scrobble] 提交正在播放失败", error);
      }
    };

    void submitNowPlaying();
  }, [
    canScrobble,
    currentTrack,
    isPlaying,
    lastFmApiKey,
    lastFmApiSecret,
    lastFmSessionKey,
    listenBrainzToken,
    scrobbleProvider,
  ]);

  useEffect(() => {
    if (!currentTrack || !isPlaying || !canScrobble) {
      return;
    }

    if (scrobbledRef.current.has(currentTrack.id)) {
      return;
    }

    const minimumScrobbleSeconds = Math.min(240, Math.max(20, currentTrack.duration * 0.5));
    if (progress < minimumScrobbleSeconds) {
      return;
    }

    scrobbledRef.current.add(currentTrack.id);

    const submitScrobble = async () => {
      try {
        if (scrobbleProvider === "listenbrainz") {
          await submitListenBrainzScrobble(listenBrainzToken, currentTrack);
          return;
        }

        if (scrobbleProvider === "lastfm") {
          await submitLastFmMethod("track.scrobble", {
            track: currentTrack,
            apiKey: lastFmApiKey,
            apiSecret: lastFmApiSecret,
            sessionKey: lastFmSessionKey,
          });
        }
      } catch (error) {
        console.warn("[Scrobble] 提交听歌记录失败", error);
      }
    };

    void submitScrobble();
  }, [
    canScrobble,
    currentTrack,
    isPlaying,
    lastFmApiKey,
    lastFmApiSecret,
    lastFmSessionKey,
    listenBrainzToken,
    progress,
    scrobbleProvider,
  ]);
}
