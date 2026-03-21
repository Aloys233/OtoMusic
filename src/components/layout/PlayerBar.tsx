import { motion } from "framer-motion";
import {
  ListMusic,
  Music4,
  Pause,
  Play,
  Repeat1,
  Repeat2,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
} from "lucide-react";
import { type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from "react";

import { audioEngine } from "@/lib/audio/AudioEngine";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

import { Button } from "../ui/button";
import { Slider } from "../ui/slider";

type PlayerBarProps = {
  className?: string;
  nowPlayingOpen?: boolean;
  onOpenNowPlaying?: () => void;
  onToggleNowPlaying?: () => void;
};

type HoverSeekState = {
  ratio: number;
  seconds: number;
};

const repeatModeMap = {
  off: "all",
  all: "one",
  one: "off",
} as const;

function formatTime(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function resolveSeekProgress(clientX: number, bounds: DOMRect, duration: number): HoverSeekState | null {
  if (bounds.width <= 0) {
    return null;
  }

  const pointerRatio = (clientX - bounds.left) / bounds.width;
  const ratio = Math.min(1, Math.max(0, pointerRatio));
  return {
    ratio,
    seconds: ratio * duration,
  };
}

export function PlayerBar({
  className,
  nowPlayingOpen = false,
  onOpenNowPlaying,
  onToggleNowPlaying,
}: PlayerBarProps) {
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const queue = usePlayerStore((state) => state.queue);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const volume = usePlayerStore((state) => state.volume);
  const repeatMode = usePlayerStore((state) => state.repeatMode);
  const shuffle = usePlayerStore((state) => state.shuffle);

  const setVolume = usePlayerStore((state) => state.setVolume);
  const setProgress = usePlayerStore((state) => state.setProgress);
  const setPlaying = usePlayerStore((state) => state.setPlaying);
  const setRepeatMode = usePlayerStore((state) => state.setRepeatMode);
  const toggleShuffle = usePlayerStore((state) => state.toggleShuffle);
  const playNext = usePlayerStore((state) => state.playNext);
  const playPrevious = usePlayerStore((state) => state.playPrevious);

  const [hoverSeek, setHoverSeek] = useState<HoverSeekState | null>(null);

  // Refs for direct DOM progress updates — avoids React re-renders during playback
  const fillRef = useRef<HTMLSpanElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);

  const fallbackDuration = 225;
  const duration = Math.max(1, currentTrack?.duration ?? fallbackDuration);

  useEffect(() => {
    audioEngine.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    if (!isPlaying || !currentTrack?.streamUrl) {
      return;
    }

    let canceled = false;

    void audioEngine
      .playStream(currentTrack.streamUrl, {
        trackGainDb: currentTrack.trackGainDb,
        albumGainDb: currentTrack.albumGainDb,
        preferAlbumGain: false,
      })
      .catch((error) => {
        if (canceled) {
          return;
        }
        console.error("play stream failed", error);
        setPlaying(false);
      });

    return () => {
      canceled = true;
    };
  }, [
    currentTrack?.id,
    currentTrack?.streamUrl,
    currentTrack?.trackGainDb,
    currentTrack?.albumGainDb,
    isPlaying,
    setPlaying,
  ]);

  // Sync progress DOM when duration changes (track switch)
  useLayoutEffect(() => {
    const t = Math.min(audioEngine.getCurrentTime(), duration);
    const pct = (t / duration) * 100;
    if (fillRef.current) fillRef.current.style.width = `${pct}%`;
    if (thumbRef.current) thumbRef.current.style.left = `calc(${pct}% - 6px)`;
    if (timeRef.current) timeRef.current.textContent = formatTime(t);
  }, [duration]);

  // RAF loop — direct DOM manipulation, no React state updates
  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    let frameId = 0;
    let lastStoreSync = 0;

    const tick = () => {
      const t = audioEngine.getCurrentTime();
      const safeT = Math.min(t, duration);
      const pct = (safeT / duration) * 100;

      if (fillRef.current) fillRef.current.style.width = `${pct}%`;
      if (thumbRef.current) thumbRef.current.style.left = `calc(${pct}% - 6px)`;
      if (timeRef.current) timeRef.current.textContent = formatTime(safeT);

      // Sync to store every ~1s (infrequent, won't cause jank)
      if (t - lastStoreSync >= 1) {
        lastStoreSync = t;
        setProgress(t);
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [isPlaying, duration, setProgress]);

  useEffect(() => {
    let unbind: (() => void) | undefined;
    let disposed = false;

    void audioEngine.onEnded(() => {
      setProgress(0);

      if (repeatMode === "one" && currentTrack?.streamUrl) {
        void audioEngine
          .playStream(currentTrack.streamUrl, {
            trackGainDb: currentTrack.trackGainDb,
            albumGainDb: currentTrack.albumGainDb,
            preferAlbumGain: false,
          })
          .then(() => {
            setPlaying(true);
          })
          .catch((error) => {
            console.error("replay track failed", error);
            setPlaying(false);
          });
        return;
      }

      if (queue.length === 0) {
        setPlaying(false);
        return;
      }

      const moved = playNext();
      if (!moved) {
        setPlaying(false);
        return;
      }

      setPlaying(true);
    }).then((cleanup) => {
      if (disposed) {
        cleanup();
        return;
      }

      unbind = cleanup;
    });

    return () => {
      disposed = true;
      unbind?.();
    };
  }, [
    currentTrack?.albumGainDb,
    currentTrack?.streamUrl,
    currentTrack?.trackGainDb,
    playNext,
    repeatMode,
    setPlaying,
    setProgress,
    queue.length,
  ]);

  const handleTogglePlay = async () => {
    if (!currentTrack?.streamUrl) {
      return;
    }

    try {
      if (isPlaying) {
        await audioEngine.pause();
        setPlaying(false);
        return;
      }

      setPlaying(true);
    } catch (error) {
      console.error("toggle play failed", error);
      setPlaying(false);
    }
  };

  const handleVolumeChange = (value: number[]) => {
    const nextVolume = (value[0] ?? 75) / 100;
    setVolume(nextVolume);
  };

  const handleProgressBarSeek = (event: MouseEvent<HTMLButtonElement>) => {
    if (!currentTrack?.streamUrl) {
      return;
    }

    const next = resolveSeekProgress(
      event.clientX,
      event.currentTarget.getBoundingClientRect(),
      duration,
    );
    if (!next) {
      return;
    }

    setProgress(next.seconds);
    void audioEngine.seek(next.seconds);

    // Immediately update DOM (no wait for next RAF tick)
    const pct = (next.seconds / duration) * 100;
    if (fillRef.current) fillRef.current.style.width = `${pct}%`;
    if (thumbRef.current) thumbRef.current.style.left = `calc(${pct}% - 6px)`;
    if (timeRef.current) timeRef.current.textContent = formatTime(next.seconds);
  };

  const handleProgressHover = (event: MouseEvent<HTMLButtonElement>) => {
    const next = resolveSeekProgress(
      event.clientX,
      event.currentTarget.getBoundingClientRect(),
      duration,
    );
    setHoverSeek(next);
  };

  const handleRepeatToggle = () => {
    setRepeatMode(repeatModeMap[repeatMode]);
  };

  const handlePlayPrevious = () => {
    const moved = playPrevious();
    if (moved && !isPlaying) {
      setPlaying(true);
    }
  };

  const handlePlayNext = () => {
    const moved = playNext();
    if (moved && !isPlaying) {
      setPlaying(true);
    }
  };

  const trackTitle = currentTrack?.title ?? "FLAC Placeholder Track";
  const trackArtist = currentTrack?.artist ?? "Unknown Artist";

  return (
    <motion.footer
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut", delay: 0.1 }}
      className={cn(
        "absolute inset-x-0 bottom-0 z-40 overflow-hidden border-t border-slate-200/80 bg-slate-100/95 px-3 py-2 shadow-[0_-6px_26px_rgba(15,23,42,0.08)] dark:border-slate-800/80 dark:bg-slate-950/95 dark:shadow-[0_-8px_28px_rgba(2,6,23,0.46)] sm:px-4",
        className,
      )}
    >
      <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,540px)_minmax(0,1fr)]">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <button
            type="button"
            aria-label="open-now-playing"
            onClick={onOpenNowPlaying ?? onToggleNowPlaying}
            disabled={!currentTrack}
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200/80 bg-slate-100 transition-colors hover:border-emerald-400/70 dark:border-slate-700/70 dark:bg-slate-900",
              !currentTrack && "cursor-not-allowed opacity-60 hover:border-slate-200/80 dark:hover:border-slate-700/70",
            )}
          >
            {currentTrack?.coverUrl ? (
              <img
                src={currentTrack.coverUrl}
                alt={`${trackTitle} cover`}
                className="h-full w-full object-cover"
              />
            ) : (
              <Music4 className="h-5 w-5 text-slate-500 dark:text-slate-400" />
            )}
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{trackTitle}</p>
            <p className="truncate text-xs text-slate-600 dark:text-slate-300">{trackArtist}</p>
          </div>
        </div>

        <div className="flex min-w-0 flex-col items-center gap-2">
          <div className="flex items-center gap-1 sm:gap-1.5">
            <Button
              size="icon"
              variant="ghost"
              aria-label="shuffle"
              onClick={toggleShuffle}
              disabled={queue.length <= 1}
              className={cn("hidden sm:inline-flex", shuffle && "bg-slate-200 dark:bg-slate-800")}
            >
              <Shuffle className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="previous"
              onClick={handlePlayPrevious}
              disabled={queue.length === 0}
            >
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              aria-label="play-pause"
              onClick={() => {
                void handleTogglePlay();
              }}
              disabled={!currentTrack?.streamUrl}
              className="h-11 w-11 rounded-full"
            >
              {isPlaying ? <Pause className="h-4.5 w-4.5" /> : <Play className="h-4.5 w-4.5" />}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="next"
              onClick={handlePlayNext}
              disabled={queue.length === 0}
            >
              <SkipForward className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="repeat"
              onClick={handleRepeatToggle}
              className={cn("hidden sm:inline-flex", repeatMode !== "off" && "bg-slate-200 dark:bg-slate-800")}
            >
              {repeatMode === "one" ? <Repeat1 className="h-4 w-4" /> : <Repeat2 className="h-4 w-4" />}
            </Button>
          </div>

          <div className="flex w-full max-w-[460px] items-center gap-2.5 px-1">
            <span ref={timeRef} className="w-9 text-right text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
              0:00
            </span>

            <button
              type="button"
              aria-label="seek-progress"
              disabled={!currentTrack?.streamUrl}
              onClick={handleProgressBarSeek}
              onMouseMove={handleProgressHover}
              onMouseLeave={() => setHoverSeek(null)}
              className="relative h-4 flex-1 cursor-pointer disabled:cursor-not-allowed"
            >
              <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-slate-300/80 dark:bg-slate-700/85" />
              <span
                ref={fillRef}
                className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-red-500"
              />
              <span
                ref={thumbRef}
                className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-white bg-red-500 shadow-sm dark:border-slate-900"
              />

              {hoverSeek ? (
                <span
                  className="pointer-events-none absolute bottom-4 -translate-x-1/2 rounded-md bg-slate-900/90 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white shadow"
                  style={{ left: `${hoverSeek.ratio * 100}%` }}
                >
                  {formatTime(hoverSeek.seconds)}
                </span>
              ) : null}
            </button>

            <span className="w-9 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
              {formatTime(duration)}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 sm:gap-3">
          <Volume2 className="hidden h-4 w-4 text-slate-600 dark:text-slate-300 sm:block" />
          <Slider
            value={[Math.round(volume * 100)]}
            max={100}
            step={1}
            className="w-20 sm:w-28"
            onValueChange={handleVolumeChange}
          />
          <Button
            size="icon"
            variant="ghost"
            aria-label="toggle-now-playing-sheet"
            onClick={onToggleNowPlaying}
            disabled={!currentTrack}
            className={cn(nowPlayingOpen && "bg-slate-200 dark:bg-slate-800")}
          >
            <ListMusic className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </motion.footer>
  );
}
