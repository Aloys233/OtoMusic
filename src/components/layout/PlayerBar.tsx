import { AnimatePresence, motion } from "framer-motion";
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
  X,
} from "lucide-react";
import {
  type MouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { audioEngine } from "@/lib/audio/AudioEngine";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";
import { resolveMaxBitrateKbps, type ReplayGainMode, useSettingsStore } from "@/stores/settings-store";

import { Button } from "../ui/button";
import { Slider } from "../ui/slider";

type PlayerBarProps = {
  className?: string;
  nowPlayingOpen?: boolean;
  onOpenNowPlaying?: () => void;
  onToggleNowPlaying?: () => void;
  onArtistClick?: (artistName: string) => void;
  onAlbumClick?: (albumId: string) => void;
  onSelectTrack?: (trackId: string) => void;
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

function buildReplayGainOptions(
  track: {
    trackGainDb?: number;
    albumGainDb?: number;
    trackPeak?: number;
    albumPeak?: number;
  } | undefined | null,
  mode: ReplayGainMode,
) {
  if (mode === "off") {
    return {
      trackGainDb: 0,
      albumGainDb: 0,
      trackPeak: undefined,
      albumPeak: undefined,
      preferAlbumGain: false,
    };
  }
  return {
    trackGainDb: track?.trackGainDb,
    albumGainDb: track?.albumGainDb,
    trackPeak: track?.trackPeak,
    albumPeak: track?.albumPeak,
    preferAlbumGain: mode === "album",
  };
}

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

function isKeyboardEventFromInteractiveElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(
    target.closest(
      "input, textarea, select, button, a[href], [role='button'], [contenteditable='true']",
    ),
  );
}

export function PlayerBar({
  className,
  nowPlayingOpen = false,
  onOpenNowPlaying,
  onToggleNowPlaying,
  onArtistClick,
  onAlbumClick,
  onSelectTrack,
}: PlayerBarProps) {
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const queue = usePlayerStore((state) => state.queue);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const volume = usePlayerStore((state) => state.volume);
  const repeatMode = usePlayerStore((state) => state.repeatMode);
  const shuffle = usePlayerStore((state) => state.shuffle);
  const streamQuality = useSettingsStore((state) => state.streamQuality);
  const replayGainMode = useSettingsStore((state) => state.replayGainMode);
  const audioPassthroughEnabled = useSettingsStore((state) => state.audioPassthroughEnabled);

  const setVolume = usePlayerStore((state) => state.setVolume);
  const setProgress = usePlayerStore((state) => state.setProgress);
  const setPlaying = usePlayerStore((state) => state.setPlaying);
  const setRepeatMode = usePlayerStore((state) => state.setRepeatMode);
  const toggleShuffle = usePlayerStore((state) => state.toggleShuffle);
  const playNext = usePlayerStore((state) => state.playNext);
  const playPrevious = usePlayerStore((state) => state.playPrevious);

  const [hoverSeek, setHoverSeek] = useState<HoverSeekState | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);

  // Refs for direct DOM progress updates — avoids React re-renders during playback
  const fillRef = useRef<HTMLSpanElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);

  const fallbackDuration = 225;
  const duration = Math.max(1, currentTrack?.duration ?? fallbackDuration);
  const volumePercent = Math.round(volume * 100);
  const effectiveStreamUrl = useMemo(() => {
    if (!currentTrack?.streamUrl) {
      return "";
    }

    try {
      const url = new URL(currentTrack.streamUrl);
      url.searchParams.set("maxBitrate", String(resolveMaxBitrateKbps(streamQuality)));
      return url.toString();
    } catch {
      return currentTrack.streamUrl;
    }
  }, [currentTrack?.streamUrl, streamQuality]);

  useEffect(() => {
    audioEngine.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    if (!isPlaying || !effectiveStreamUrl) {
      return;
    }

    let canceled = false;

    void audioEngine
      .playStream(effectiveStreamUrl, buildReplayGainOptions(currentTrack, replayGainMode))
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
    currentTrack?.trackGainDb,
    currentTrack?.albumGainDb,
    currentTrack?.trackPeak,
    currentTrack?.albumPeak,
    effectiveStreamUrl,
    isPlaying,
    replayGainMode,
    audioPassthroughEnabled,
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
      if (Math.abs(t - lastStoreSync) >= 1) {
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

      if (repeatMode === "one" && effectiveStreamUrl) {
        void audioEngine
          .playStream(effectiveStreamUrl, buildReplayGainOptions(currentTrack, replayGainMode))
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
    currentTrack?.trackGainDb,
    currentTrack?.albumPeak,
    currentTrack?.trackPeak,
    effectiveStreamUrl,
    playNext,
    replayGainMode,
    repeatMode,
    setPlaying,
    setProgress,
    queue.length,
  ]);

  const handleTogglePlay = useCallback(async () => {
    if (!effectiveStreamUrl) {
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
  }, [effectiveStreamUrl, isPlaying, setPlaying]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) {
        return;
      }

      if (event.code !== "Space" && event.key !== " ") {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }

      if (isKeyboardEventFromInteractiveElement(event.target)) {
        return;
      }

      event.preventDefault();
      void handleTogglePlay();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [handleTogglePlay]);

  const handleVolumeChange = (value: number[]) => {
    const nextVolume = (value[0] ?? 75) / 100;
    setVolume(nextVolume);
  };

  const handleProgressBarSeek = (event: MouseEvent<HTMLButtonElement>) => {
    if (!effectiveStreamUrl) {
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

  const trackTitle = currentTrack?.title ?? "未选择歌曲";
  const trackArtist = currentTrack?.artist ?? "未知艺术家";
  const canOpenArtistDetail = Boolean(currentTrack?.artist?.trim()) && Boolean(onArtistClick);
  const canOpenAlbumDetail = Boolean(currentTrack?.albumId) && Boolean(onAlbumClick);

  const handleArtistClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const artistName = currentTrack?.artist?.trim();
    if (!artistName || !onArtistClick) {
      return;
    }

    onArtistClick(artistName);
  };

  const handleAlbumClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const albumId = currentTrack?.albumId;
    if (!albumId || !onAlbumClick) {
      return;
    }

    onAlbumClick(albumId);
  };

  return (
    <>
      {/* Queue panel */}
      <AnimatePresence>
        {queueOpen && currentTrack ? (
          <motion.div
            key="queue-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="absolute inset-0 bottom-0 z-30"
            onClick={() => setQueueOpen(false)}
          >
            <motion.aside
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="absolute bottom-[88px] right-3 z-30 flex max-h-[min(420px,60vh)] w-[340px] flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white/95 shadow-[0_-8px_32px_rgba(0,0,0,0.12)] backdrop-blur-xl dark:border-slate-700/70 dark:bg-slate-900/95 dark:shadow-[0_-8px_32px_rgba(0,0,0,0.4)] sm:right-4 sm:w-[380px]"
            >
              <div className="flex items-center justify-between border-b border-slate-200/60 px-4 py-3 dark:border-slate-700/60">
                <h3 className="text-sm font-semibold">播放队列</h3>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  {queue.length} 首
                </span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
                {queue.length === 0 ? (
                  <div className="flex h-24 items-center justify-center text-sm text-slate-400 dark:text-slate-500">
                    队列为空
                  </div>
                ) : (
                  <div className="p-1.5">
                    {queue.map((track, index) => {
                      const active = track.id === currentTrack.id;
                      return (
                        <button
                          key={`${track.id}-${index}`}
                          type="button"
                          onClick={() => {
                            onSelectTrack?.(track.id);
                          }}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                            active
                              ? "bg-[var(--accent-soft)] text-[var(--accent-text)] dark:text-emerald-400"
                              : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                          )}
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800">
                            {track.coverUrl ? (
                              <img
                                src={track.coverUrl}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <Music4 className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{track.title}</p>
                            {onArtistClick && track.artist?.trim() ? (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onArtistClick(track.artist.trim()); }}
                                className={cn(
                                  "truncate text-xs transition-colors hover:text-[var(--accent-text)] hover:underline",
                                  active ? "text-[var(--accent-text)]/70 dark:text-emerald-400/70" : "text-slate-500 dark:text-slate-400",
                                )}
                              >
                                {track.artist}
                              </button>
                            ) : (
                              <p className={cn(
                                "truncate text-xs",
                                active ? "text-[var(--accent-text)]/70 dark:text-emerald-400/70" : "text-slate-500 dark:text-slate-400",
                              )}>
                                {track.artist}
                              </p>
                            )}
                          </div>
                          <span className={cn(
                            "shrink-0 text-xs tabular-nums",
                            active ? "text-[var(--accent-text)]/70 dark:text-emerald-400/70" : "text-slate-400 dark:text-slate-500",
                          )}>
                            {formatTime(track.duration)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>

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
              "flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200/80 bg-slate-100 transition-[transform,border-color,background-color] duration-[320ms] ease-in-out hover:scale-[1.02] hover:border-[var(--accent-border)] dark:border-slate-700/70 dark:bg-slate-900",
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
            {canOpenAlbumDetail ? (
              <button
                type="button"
                onClick={handleAlbumClick}
                className="block w-full truncate text-left text-sm font-medium transition-colors hover:text-[var(--accent-text)] hover:underline"
                title={`查看专辑`}
              >
                {trackTitle}
              </button>
            ) : (
              <p className="truncate text-sm font-medium">{trackTitle}</p>
            )}
            {canOpenArtistDetail ? (
              <button
                type="button"
                onClick={handleArtistClick}
                className="block w-full truncate text-left text-xs text-slate-600 transition-colors hover:text-[var(--accent-text)] dark:text-slate-300 dark:hover:text-[var(--accent-text)]"
                title={`查看 ${trackArtist} 详情`}
              >
                {trackArtist}
              </button>
            ) : (
              <p className="truncate text-xs text-slate-600 dark:text-slate-300">{trackArtist}</p>
            )}
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
              className={cn("hidden sm:inline-flex duration-[120ms] ease-out active:scale-[0.9]", shuffle && "bg-slate-200 dark:bg-slate-800")}
            >
              <Shuffle className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="previous"
              onClick={handlePlayPrevious}
              disabled={queue.length === 0}
              className="duration-[120ms] ease-out active:scale-[0.9]"
            >
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              aria-label="play-pause"
              onClick={() => {
                void handleTogglePlay();
              }}
              disabled={!effectiveStreamUrl}
              className="h-11 w-11 rounded-full duration-[120ms] ease-out active:scale-[0.88] active:brightness-90"
            >
              {isPlaying ? <Pause className="h-4.5 w-4.5" /> : <Play className="h-4.5 w-4.5" />}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="next"
              onClick={handlePlayNext}
              disabled={queue.length === 0}
              className="duration-[120ms] ease-out active:scale-[0.9]"
            >
              <SkipForward className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="repeat"
              onClick={handleRepeatToggle}
              className={cn("hidden sm:inline-flex duration-[120ms] ease-out active:scale-[0.9]", repeatMode !== "off" && "bg-slate-200 dark:bg-slate-800")}
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
              data-press-animation="off"
              disabled={!effectiveStreamUrl}
              onClick={handleProgressBarSeek}
              onMouseMove={handleProgressHover}
              onMouseLeave={() => setHoverSeek(null)}
              className="relative h-4 flex-1 cursor-pointer disabled:cursor-not-allowed"
            >
              <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-slate-300/80 dark:bg-slate-700/85" />
              <span
                ref={fillRef}
                className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--accent-solid)]"
              />
              <span
                ref={thumbRef}
                className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-white bg-[var(--accent-solid)] shadow-sm dark:border-slate-900"
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
            value={[volumePercent]}
            max={100}
            step={1}
            className="w-20 sm:w-28"
            onValueChange={handleVolumeChange}
          />
          <span className="w-10 text-right text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
            {volumePercent}%
          </span>
          <Button
            size="icon"
            variant="ghost"
            aria-label="toggle-queue"
            onClick={() => setQueueOpen((prev) => !prev)}
            disabled={!currentTrack}
            className={cn(queueOpen && "bg-slate-200 dark:bg-slate-800")}
          >
            <ListMusic className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </motion.footer>
    </>
  );
}
