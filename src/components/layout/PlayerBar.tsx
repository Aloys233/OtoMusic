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
import { type MouseEvent, useEffect, useRef } from "react";

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

export function PlayerBar({
  className,
  nowPlayingOpen = false,
  onOpenNowPlaying,
  onToggleNowPlaying,
}: PlayerBarProps) {
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const queue = usePlayerStore((state) => state.queue);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const progress = usePlayerStore((state) => state.progress);
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

  const fallbackDuration = 225;
  const duration = Math.max(1, currentTrack?.duration ?? fallbackDuration);
  const safeProgress = Math.min(progress, duration);
  const publishedProgressRef = useRef(-1);

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

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    let frameId = 0;
    const PROGRESS_STEP_SECONDS = 0.04;

    const updateProgress = () => {
      const currentTime = audioEngine.getCurrentTime();
      const quantizedProgress =
        Math.round(currentTime / PROGRESS_STEP_SECONDS) * PROGRESS_STEP_SECONDS;

      if (quantizedProgress !== publishedProgressRef.current) {
        publishedProgressRef.current = quantizedProgress;
        setProgress(quantizedProgress);
      }

      frameId = requestAnimationFrame(updateProgress);
    };

    publishedProgressRef.current = -1;
    frameId = requestAnimationFrame(updateProgress);
    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [isPlaying, setProgress]);

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

    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) {
      return;
    }

    const pointerRatio = (event.clientX - bounds.left) / bounds.width;
    const nextProgress = Math.min(duration, Math.max(0, pointerRatio * duration));
    setProgress(nextProgress);
    void audioEngine.seek(nextProgress);
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
  const progressPercent = (safeProgress / duration) * 100;

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
      <button
        type="button"
        aria-label="seek-progress"
        disabled={!currentTrack?.streamUrl}
        onClick={handleProgressBarSeek}
        className="absolute inset-x-0 top-0 z-20 h-[2px] cursor-pointer bg-red-500/16 transition-colors hover:bg-red-500/24 disabled:cursor-not-allowed disabled:bg-red-500/10"
      >
        <span
          className="block h-full bg-red-500 transition-[width] duration-150 ease-out"
          style={{ width: `${progressPercent}%` }}
        />
      </button>

      <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-3 pt-1 md:grid-cols-[minmax(0,260px)_auto_minmax(0,240px)]">
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

        <div className="flex min-w-0 flex-col items-center gap-1.5">
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
              onClick={() => void handleTogglePlay()}
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

          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {formatTime(safeProgress)} / {formatTime(duration)}
          </p>
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
