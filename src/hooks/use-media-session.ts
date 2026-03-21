import { useEffect } from "react";

import { audioEngine } from "@/lib/audio/AudioEngine";
import { usePlayerStore } from "@/stores/player-store";

function supportsMediaSession() {
  return typeof navigator !== "undefined" && "mediaSession" in navigator;
}

function supportsMediaMetadata() {
  return typeof MediaMetadata !== "undefined";
}

function isLinuxDesktop() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const userAgent = navigator.userAgent.toLowerCase();
  return userAgent.includes("linux") && !userAgent.includes("android");
}

const POSITION_SYNC_INTERVAL_MS = 1_000;

export function useMediaSession() {
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const playNext = usePlayerStore((state) => state.playNext);
  const playPrevious = usePlayerStore((state) => state.playPrevious);
  const setPlaying = usePlayerStore((state) => state.setPlaying);
  const setProgress = usePlayerStore((state) => state.setProgress);

  useEffect(() => {
    if (!supportsMediaSession()) {
      return;
    }

    try {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    } catch {
      // 某些平台实现不完整
    }
  }, [isPlaying]);

  useEffect(() => {
    if (!supportsMediaSession()) {
      return;
    }

    if (!currentTrack) {
      try {
        navigator.mediaSession.metadata = null;
      } catch {
        // ignore
      }
      return;
    }

    if (!supportsMediaMetadata()) {
      return;
    }

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        album: "OtoMusic",
        artwork: currentTrack.coverUrl
          ? [
              {
                src: currentTrack.coverUrl,
                sizes: "512x512",
              },
            ]
          : undefined,
      });
    } catch {
      // ignore metadata failures to prevent runtime crash
    }
  }, [currentTrack]);

  useEffect(() => {
    if (!supportsMediaSession()) {
      return;
    }

    const setActionHandler = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null,
    ) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // 部分平台不支持全部动作
      }
    };

    setActionHandler("play", () => {
      if (!usePlayerStore.getState().currentTrack?.streamUrl) {
        return;
      }
      setPlaying(true);
    });

    setActionHandler("pause", () => {
      void audioEngine.pause();
      setPlaying(false);
    });

    setActionHandler("previoustrack", () => {
      const moved = playPrevious();
      if (moved) {
        setPlaying(true);
      }
    });

    setActionHandler("nexttrack", () => {
      const moved = playNext();
      if (moved) {
        setPlaying(true);
      }
    });

    setActionHandler("seekto", (details) => {
      if (typeof details.seekTime !== "number") {
        return;
      }
      setProgress(details.seekTime);
      void audioEngine.seek(details.seekTime);
    });

    setActionHandler("seekforward", (details) => {
      const offset = details.seekOffset ?? 10;
      const next = audioEngine.getCurrentTime() + offset;
      setProgress(next);
      void audioEngine.seek(next);
    });

    setActionHandler("seekbackward", (details) => {
      const offset = details.seekOffset ?? 10;
      const next = Math.max(0, audioEngine.getCurrentTime() - offset);
      setProgress(next);
      void audioEngine.seek(next);
    });

    return () => {
      setActionHandler("play", null);
      setActionHandler("pause", null);
      setActionHandler("previoustrack", null);
      setActionHandler("nexttrack", null);
      setActionHandler("seekto", null);
      setActionHandler("seekforward", null);
      setActionHandler("seekbackward", null);
    };
  }, [playNext, playPrevious, setPlaying, setProgress]);

  useEffect(() => {
    if (!supportsMediaSession()) {
      return;
    }

    // WebKitGTK on some Linux desktop stacks is unstable with frequent position updates.
    if (isLinuxDesktop()) {
      return;
    }

    let lastSyncedAt = 0;
    let lastTrackId: string | null = null;
    let lastDuration = -1;
    let lastSecond = -1;

    const syncPositionState = () => {
      const { currentTrack: activeTrack, progress } = usePlayerStore.getState();
      const duration = activeTrack?.duration ?? 0;
      if (!Number.isFinite(duration) || duration <= 0) {
        return;
      }

      const now = Date.now();
      const trackId = activeTrack?.id ?? null;
      const position = Math.min(progress, duration);
      const second = Math.floor(position);

      const trackChanged = trackId !== lastTrackId;
      const durationChanged = duration !== lastDuration;
      const secondChanged = second !== lastSecond;
      const intervalElapsed = now - lastSyncedAt >= POSITION_SYNC_INTERVAL_MS;

      if (!trackChanged && !durationChanged && (!secondChanged || !intervalElapsed)) {
        return;
      }

      try {
        navigator.mediaSession.setPositionState({
          duration,
          position,
          playbackRate: 1,
        });
        lastTrackId = trackId;
        lastDuration = duration;
        lastSecond = second;
        lastSyncedAt = now;
      } catch {
        // ignore unsupported platform
      }
    };

    syncPositionState();
    const unsubscribe = usePlayerStore.subscribe((state, previousState) => {
      if (
        state.currentTrack?.id === previousState.currentTrack?.id &&
        state.progress === previousState.progress &&
        state.currentTrack?.duration === previousState.currentTrack?.duration
      ) {
        return;
      }

      syncPositionState();
    });

    return () => {
      unsubscribe();
    };
  }, []);
}
