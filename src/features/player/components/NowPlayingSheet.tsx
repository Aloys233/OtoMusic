import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AudioLines,
  ListMusic,
  Loader2,
  Music4,
  Pause,
  Play,
  Repeat1,
  Repeat2,
  Shuffle,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { LyricsData } from "@/lib/api/subsonic-client";
import { audioEngine } from "@/lib/audio/AudioEngine";
import { isElectronRuntime } from "@/lib/desktop-api";
import { useDominantColor } from "@/hooks/use-dominant-color";
import { cn } from "@/lib/utils";
import { usePlayerStore, type TrackInfo } from "@/stores/player-store";
import { resolveAudioQuality } from "@/features/player/utils/audio-quality";

import { AppleMusicLyrics } from "./AppleMusicLyrics";
import { AudioReactiveBackdrop } from "./AudioReactiveBackdrop";

type NowPlayingSheetProps = {
  open: boolean;
  currentTrack: TrackInfo | null;
  queue: TrackInfo[];
  isPlaying: boolean;
  lyrics: LyricsData;
  lyricsLoading: boolean;
  lyricsFontScale?: number;
  lyricsAlign?: "left" | "center";
  showTranslatedLyrics?: boolean;
  showRomanizedLyrics?: boolean;
  backgroundBlurEnabled?: boolean;
  highResCoverUrl?: string | null;
  onClose: () => void;
  onSelectTrack: (trackId: string) => void;
  onArtistClick?: (artistName: string) => void;
  onAlbumClick?: (albumId: string) => void;
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

export function NowPlayingSheet({
  open,
  currentTrack,
  queue,
  isPlaying,
  lyrics,
  lyricsLoading,
  lyricsFontScale = 1,
  lyricsAlign = "center",
  showTranslatedLyrics = true,
  showRomanizedLyrics = true,
  backgroundBlurEnabled = true,
  highResCoverUrl,
  onClose,
  onSelectTrack,
  onArtistClick,
  onAlbumClick,
}: NowPlayingSheetProps) {
  const isDesktop = isElectronRuntime();
  const shouldReduceMotion = useReducedMotion();
  const dragRegionStyle: CSSProperties | undefined = isDesktop
    ? { WebkitAppRegion: "drag" }
    : undefined;
  const noDragRegionStyle: CSSProperties | undefined = isDesktop
    ? { WebkitAppRegion: "no-drag" }
    : undefined;
  const hasLyrics = lyrics.text.trim().length > 0 || lyrics.timedLines.length > 0;
  const [queueOpen, setQueueOpen] = useState(false);
  const [highResStatusByUrl, setHighResStatusByUrl] = useState<Record<string, "loaded" | "failed">>({});
  const lowResCoverUrl = currentTrack?.coverUrl ?? null;
  const hasDedicatedHighResCover = Boolean(highResCoverUrl && highResCoverUrl !== lowResCoverUrl);
  const currentHighResStatus = highResCoverUrl ? highResStatusByUrl[highResCoverUrl] : undefined;
  const canUseHighResCover = hasDedicatedHighResCover && currentHighResStatus !== "failed";
  const showHighResCover = canUseHighResCover && currentHighResStatus === "loaded";
  const displayCoverUrl = showHighResCover ? (highResCoverUrl ?? null) : lowResCoverUrl;
  const ambientColor = useDominantColor(displayCoverUrl);
  const currentArtistName = currentTrack?.artist?.trim() ?? "";
  const canOpenCurrentArtistDetail = Boolean(currentArtistName) && Boolean(onArtistClick);
  const canOpenCurrentAlbumDetail = Boolean(currentTrack?.albumId) && Boolean(onAlbumClick);
  const fallbackBackdrop =
    "radial-gradient(circle at 20% 20%, rgba(16,185,129,0.25), transparent 42%), radial-gradient(circle at 80% 80%, rgba(59,130,246,0.22), transparent 45%)";

  // Player controls from store
  const setPlaying = usePlayerStore((s) => s.setPlaying);
  const setProgress = usePlayerStore((s) => s.setProgress);
  const playNext = usePlayerStore((s) => s.playNext);
  const playPrevious = usePlayerStore((s) => s.playPrevious);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const setRepeatMode = usePlayerStore((s) => s.setRepeatMode);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);

  // Progress bar refs for direct DOM manipulation
  const seekBarRef = useRef<HTMLButtonElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const isSeekingRef = useRef(false);
  const seekPreviewSecondsRef = useRef<number | null>(null);

  const duration = Math.max(1, currentTrack?.duration ?? 1);

  const handleTogglePlay = useCallback(async () => {
    if (!currentTrack?.streamUrl) return;
    try {
      if (isPlaying) {
        await audioEngine.pause();
        setPlaying(false);
      } else {
        setPlaying(true);
      }
    } catch (error) {
      console.error("toggle play failed", error);
      setPlaying(false);
    }
  }, [currentTrack?.streamUrl, isPlaying, setPlaying]);

  const handlePlayPrevious = useCallback(() => {
    const moved = playPrevious();
    if (moved && !isPlaying) setPlaying(true);
  }, [playPrevious, isPlaying, setPlaying]);

  const handlePlayNext = useCallback(() => {
    const moved = playNext();
    if (moved && !isPlaying) setPlaying(true);
  }, [playNext, isPlaying, setPlaying]);

  const handleRepeatToggle = useCallback(() => {
    setRepeatMode(repeatModeMap[repeatMode]);
  }, [repeatMode, setRepeatMode]);

  const paintSeekProgress = useCallback(
    (seconds: number) => {
      const safeSeconds = Math.min(Math.max(0, seconds), duration);
      const pct = (safeSeconds / duration) * 100;
      if (fillRef.current) fillRef.current.style.width = `${pct}%`;
      if (timeRef.current) timeRef.current.textContent = formatTime(safeSeconds);
    },
    [duration],
  );

  const resolveSeekSecondsFromClientX = useCallback(
    (clientX: number) => {
      const seekBar = seekBarRef.current;
      if (!seekBar) return null;
      const bounds = seekBar.getBoundingClientRect();
      if (bounds.width <= 0) return null;
      const ratio = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width));
      return ratio * duration;
    },
    [duration],
  );

  const commitSeek = useCallback(
    (seconds: number) => {
      const safeSeconds = Math.min(Math.max(0, seconds), duration);
      setProgress(safeSeconds);
      void audioEngine.seek(safeSeconds);
      paintSeekProgress(safeSeconds);
    },
    [duration, paintSeekProgress, setProgress],
  );

  const handleSeekPointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (!currentTrack?.streamUrl) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;

      event.currentTarget.setPointerCapture(event.pointerId);
      isSeekingRef.current = true;

      const seconds = resolveSeekSecondsFromClientX(event.clientX);
      if (seconds === null) return;
      seekPreviewSecondsRef.current = seconds;
      paintSeekProgress(seconds);
    },
    [currentTrack?.streamUrl, paintSeekProgress, resolveSeekSecondsFromClientX],
  );

  const handleSeekPointerMove = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (!isSeekingRef.current) return;
      const seconds = resolveSeekSecondsFromClientX(event.clientX);
      if (seconds === null) return;
      seekPreviewSecondsRef.current = seconds;
      paintSeekProgress(seconds);
    },
    [paintSeekProgress, resolveSeekSecondsFromClientX],
  );

  const handleSeekPointerUp = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (!isSeekingRef.current) return;
      isSeekingRef.current = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      const seconds = seekPreviewSecondsRef.current;
      seekPreviewSecondsRef.current = null;
      if (seconds === null || !currentTrack?.streamUrl) return;
      commitSeek(seconds);
    },
    [commitSeek, currentTrack?.streamUrl],
  );

  const handleSeekPointerCancel = useCallback(() => {
    isSeekingRef.current = false;
    seekPreviewSecondsRef.current = null;
  }, []);

  // RAF loop for smooth progress updates
  useEffect(() => {
    if (!isPlaying || !open) return;
    let frameId = 0;
    const tick = () => {
      if (isSeekingRef.current) {
        frameId = requestAnimationFrame(tick);
        return;
      }

      const t = Math.min(audioEngine.getCurrentTime(), duration);
      paintSeekProgress(t);
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [duration, isPlaying, open, paintSeekProgress]);

  // Reset progress display on track change
  useEffect(() => {
    if (!open) return;
    const t = Math.min(audioEngine.getCurrentTime(), duration);
    paintSeekProgress(t);
  }, [currentTrack?.id, duration, open, paintSeekProgress]);

  useEffect(() => {
    if (!open) {
      setQueueOpen(false);
    }
  }, [open]);

  useEffect(() => {
    setQueueOpen(false);
  }, [currentTrack?.id]);

  useEffect(() => {
    if (!open || !hasDedicatedHighResCover || !highResCoverUrl) return;
    if (currentHighResStatus) return;

    let disposed = false;
    const image = new Image();
    image.onload = () => {
      if (disposed) return;
      setHighResStatusByUrl((prev) => {
        if (prev[highResCoverUrl]) return prev;
        return { ...prev, [highResCoverUrl]: "loaded" };
      });
    };
    image.onerror = () => {
      if (disposed) return;
      setHighResStatusByUrl((prev) => {
        if (prev[highResCoverUrl]) return prev;
        return { ...prev, [highResCoverUrl]: "failed" };
      });
    };
    image.src = highResCoverUrl;

    return () => {
      disposed = true;
    };
  }, [currentHighResStatus, hasDedicatedHighResCover, highResCoverUrl, open]);

  const audioQuality = currentTrack
    ? resolveAudioQuality({
        suffix: currentTrack.suffix,
        bitDepth: currentTrack.bitDepth,
        sampleRate: currentTrack.sampleRate,
      })
    : null;
  const infoChips: string[] = [];
  if (currentTrack?.bitRate) infoChips.push(`${currentTrack.bitRate} kbps`);
  if (currentTrack?.duration) infoChips.push(formatTime(currentTrack.duration));

  return (
    <AnimatePresence>
      {open ? (
    <motion.section
      key="now-playing-sheet"
      role="dialog"
      aria-label="now-playing-sheet"
      initial={{ y: "105%" }}
      animate={{ y: 0 }}
      exit={{ y: "105%" }}
      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-0 z-[60] overflow-hidden bg-black"
    >
      {/* Background layers */}
      <motion.div
        className="absolute inset-0 scale-110"
        animate={shouldReduceMotion ? undefined : {
          x: [0, 22, -16, 0],
          y: [0, -18, 14, 0],
          scale: [1.08, 1.16, 1.1, 1.08],
          rotate: [0, 1.1, -0.8, 0],
        }}
        transition={shouldReduceMotion ? undefined : {
          duration: 34,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
        }}
      >
        <div
          className={cn(
            "absolute inset-0 z-0 bg-cover bg-center transition-opacity duration-500",
            backgroundBlurEnabled ? "blur-[56px]" : "blur-none",
            showHighResCover && "opacity-0",
          )}
          style={{
            backgroundImage: lowResCoverUrl ? `url(${lowResCoverUrl})` : fallbackBackdrop,
          }}
        />
        {canUseHighResCover && highResCoverUrl ? (
          <div
            className={cn(
              "absolute inset-0 z-0 bg-cover bg-center transition-opacity duration-500",
              backgroundBlurEnabled ? "blur-[56px]" : "blur-none",
              showHighResCover ? "opacity-100" : "opacity-0",
            )}
            style={{ backgroundImage: `url(${highResCoverUrl})` }}
          />
        ) : null}
      </motion.div>
      <div
        className="absolute inset-0 z-[1] opacity-75"
        style={{ background: `radial-gradient(circle at 16% 24%, ${ambientColor}, transparent 55%)` }}
      />
      <div
        className={cn(
          "absolute inset-0 z-[2] bg-black/18",
          backgroundBlurEnabled ? "backdrop-blur-2xl" : "backdrop-blur-none",
        )}
      />
      <div className="absolute inset-0 z-[2] bg-[linear-gradient(150deg,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0)_45%,rgba(0,0,0,0.15)_100%)]" />
      <div className="absolute inset-0 z-[2] bg-black/5" />
      <AudioReactiveBackdrop
        ambientColor={ambientColor}
        isPlaying={isPlaying}
        backgroundBlurEnabled={backgroundBlurEnabled}
      />

      {/* Content */}
      <div className="relative z-10 flex h-full min-h-0 flex-col">
        {/* Header - draggable for window move */}
        <div className="flex items-center justify-between px-5 py-4 text-white" style={dragRegionStyle}>
          <h2 className="text-lg font-semibold tracking-tight">正在播放</h2>
          <div className="flex items-center gap-2" style={noDragRegionStyle}>
            {currentTrack ? (
              <button
                type="button"
                aria-label="toggle-queue"
                onClick={() => setQueueOpen((prev) => !prev)}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 text-sm text-white backdrop-blur-xl transition-colors hover:bg-white/20",
                  queueOpen && "bg-white/25",
                )}
              >
                <ListMusic className="h-4 w-4" />
                <span className="rounded-full bg-white/25 px-1.5 py-0.5 text-xs">{queue.length}</span>
              </button>
            ) : null}
            <button
              type="button"
              aria-label="close-sheet"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Main content grid */}
        <div className="grid min-h-0 flex-1 gap-2 px-4 pb-4 lg:grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)] lg:gap-5 lg:px-7">
          {/* Left: Player panel */}
          <section className="flex min-h-0 flex-col items-center justify-center gap-4 px-2 text-white lg:px-4">
            {!currentTrack ? (
              <div className="flex h-full items-center justify-center text-sm text-white/70">
                还没有正在播放的歌曲
              </div>
            ) : (
              <>
                {/* Album art */}
                <div className="w-full max-w-[16rem] sm:max-w-[18rem] lg:max-w-[20rem]">
                  <div className="relative aspect-square overflow-hidden rounded-[1.5rem] bg-white/10 shadow-[0_32px_90px_rgba(0,0,0,0.62)] ring-1 ring-white/15">
                    {lowResCoverUrl ? (
                      canUseHighResCover && highResCoverUrl ? (
                        <>
                          <img
                            src={lowResCoverUrl}
                            alt={`${currentTrack.title} cover placeholder`}
                            className={cn(
                              "absolute inset-0 h-full w-full scale-110 object-cover blur-lg transition-opacity duration-500",
                              showHighResCover ? "opacity-0" : "opacity-100",
                            )}
                          />
                          <img
                            src={highResCoverUrl}
                            alt={`${currentTrack.title} cover`}
                            className={cn(
                              "absolute inset-0 h-full w-full object-cover transition-opacity duration-500",
                              showHighResCover ? "opacity-100" : "opacity-0",
                            )}
                          />
                        </>
                      ) : (
                        <img
                          src={lowResCoverUrl}
                          alt={`${currentTrack.title} cover`}
                          className="h-full w-full object-cover"
                        />
                      )
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Music4 className="h-16 w-16 text-white/70" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Title + Artist */}
                <div className="w-full max-w-[22rem] text-center">
                  {canOpenCurrentAlbumDetail ? (
                    <button
                      type="button"
                      onClick={() => onAlbumClick?.(currentTrack.albumId!)}
                      className="block w-full truncate text-xl font-semibold tracking-tight sm:text-[1.35rem] transition-colors hover:text-[var(--accent-soft-strong)] hover:underline"
                      title="查看专辑"
                    >
                      {currentTrack.title}
                    </button>
                  ) : (
                    <p className="truncate text-xl font-semibold tracking-tight sm:text-[1.35rem]">
                      {currentTrack.title}
                    </p>
                  )}
                  {canOpenCurrentArtistDetail ? (
                    <button
                      type="button"
                      onClick={() => onArtistClick?.(currentArtistName)}
                      className="mt-1 block w-full truncate text-center text-sm text-white/70 transition-colors hover:text-[var(--accent-soft-strong)]"
                      title={`查看 ${currentArtistName} 详情`}
                    >
                      {currentTrack.artist}
                    </button>
                  ) : (
                    <p className="mt-1 truncate text-sm text-white/70">
                      {currentTrack.artist}
                    </p>
                  )}
                </div>

                {/* Progress bar */}
                <div className="flex w-full max-w-[22rem] items-center gap-2.5">
                  <span
                    ref={timeRef}
                    className="w-9 text-right text-[11px] tabular-nums text-white/60"
                  >
                    0:00
                  </span>
                  <button
                    ref={seekBarRef}
                    type="button"
                    aria-label="seek-progress"
                    data-press-animation="off"
                    disabled={!currentTrack.streamUrl}
                    onPointerDown={handleSeekPointerDown}
                    onPointerMove={handleSeekPointerMove}
                    onPointerUp={handleSeekPointerUp}
                    onPointerCancel={handleSeekPointerCancel}
                    className="relative h-5 flex-1 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <span className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-white/22 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" />
                    <span
                      ref={fillRef}
                      className="absolute left-0 top-1/2 z-[1] h-2 -translate-y-1/2 overflow-visible rounded-full bg-white"
                      style={{ width: "0%" }}
                    >
                      <motion.span
                        className="pointer-events-none absolute inset-y-0 right-2 z-[2] w-10 bg-[linear-gradient(90deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.14)_58%,rgba(255,255,255,0.68)_100%)]"
                        animate={shouldReduceMotion ? undefined : { opacity: [0.5, 0.66, 0.5] }}
                        transition={shouldReduceMotion ? undefined : { duration: 2.1, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-0 z-[3] w-3 rounded-full bg-white" />
                      <span className="pointer-events-none absolute right-0 top-1/2 z-[4] h-2 w-3 -translate-y-1/2">
                        <motion.span
                          className="block h-full w-full rounded-full shadow-[0_0_7px_rgba(255,255,255,0.9),0_0_12px_rgba(255,255,255,0.56)]"
                          animate={shouldReduceMotion ? undefined : { opacity: [0.72, 0.9, 0.72] }}
                          transition={shouldReduceMotion ? undefined : { duration: 2.1, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
                        />
                      </span>
                    </span>
                  </button>
                  <span className="w-9 text-[11px] tabular-nums text-white/60">
                    {formatTime(duration)}
                  </span>
                </div>

                {/* Control buttons */}
                <div className="mx-auto flex items-center gap-2.5">
                  <button
                    type="button"
                    aria-label="shuffle"
                    onClick={toggleShuffle}
                    disabled={queue.length <= 1}
                    className={cn(
                      "relative inline-flex h-10 w-10 items-center justify-center rounded-full transition-[transform,color,opacity] duration-[120ms] ease-out active:scale-[0.93] disabled:opacity-30",
                      shuffle
                        ? "text-[var(--accent-solid)]"
                        : "text-white/78 hover:text-white",
                    )}
                  >
                    <Shuffle className="h-[18px] w-[18px]" />
                  </button>
                  <button
                    type="button"
                    aria-label="previous"
                    onClick={handlePlayPrevious}
                    disabled={queue.length === 0}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full text-white/92 transition-[transform,color,opacity] duration-[120ms] ease-out hover:text-white active:scale-[0.93] disabled:opacity-30"
                  >
                    <SkipBack className="h-[20px] w-[20px] fill-current" />
                  </button>
                  <button
                    type="button"
                    aria-label="play-pause"
                    onClick={() => void handleTogglePlay()}
                    disabled={!currentTrack.streamUrl}
                    className="inline-flex h-[52px] w-[52px] items-center justify-center rounded-full bg-white text-black/90 shadow-[0_5px_16px_rgba(0,0,0,0.3)] transition-[transform,background-color,box-shadow,opacity] duration-[120ms] ease-out hover:bg-white/95 active:scale-[0.9] active:shadow-[0_2px_8px_rgba(0,0,0,0.22)] disabled:opacity-30"
                  >
                    {isPlaying ? (
                      <Pause className="h-[18px] w-[18px] fill-current" />
                    ) : (
                      <Play className="h-[18px] w-[18px] translate-x-[1px] fill-current" />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label="next"
                    onClick={handlePlayNext}
                    disabled={queue.length === 0}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full text-white/92 transition-[transform,color,opacity] duration-[120ms] ease-out hover:text-white active:scale-[0.93] disabled:opacity-30"
                  >
                    <SkipForward className="h-[20px] w-[20px] fill-current" />
                  </button>
                  <button
                    type="button"
                    aria-label="repeat"
                    onClick={handleRepeatToggle}
                    className={cn(
                      "inline-flex h-10 w-10 items-center justify-center rounded-full transition-[transform,color,opacity] duration-[120ms] ease-out active:scale-[0.93]",
                      repeatMode !== "off"
                        ? "text-[var(--accent-solid)]"
                        : "text-white/78 hover:text-white",
                    )}
                  >
                    {repeatMode === "one"
                      ? <Repeat1 className="h-[18px] w-[18px]" />
                      : <Repeat2 className="h-[18px] w-[18px]" />}
                  </button>
                </div>

                {/* Song info chips */}
                {audioQuality || infoChips.length > 0 ? (
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {audioQuality ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full border border-emerald-300/30 bg-emerald-400/10 px-2.5 py-0.5 text-[11px] tabular-nums text-emerald-200"
                      >
                        <AudioLines className="h-3 w-3" />
                        <span>{audioQuality.label}</span>
                        {audioQuality.parameterText ? (
                          <span className="text-emerald-100/85">{audioQuality.parameterText}</span>
                        ) : null}
                      </span>
                    ) : null}
                    {infoChips.map((chip, index) => (
                      <span
                        key={`${chip}-${index}`}
                        className="rounded-full border border-white/15 bg-white/8 px-2.5 py-0.5 text-[11px] tabular-nums text-white/55"
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </section>

          {/* Right: Lyrics (full coverage) */}
          <section className="min-h-0 overflow-hidden text-white">
            {!currentTrack ? (
              <div className="flex h-full items-center justify-center text-sm text-white/70">
                播放歌曲后显示歌词
              </div>
            ) : lyricsLoading ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-white/70">
                <Loader2 className="h-4 w-4 animate-spin" />
                加载歌词中...
              </div>
            ) : hasLyrics ? (
              <AppleMusicLyrics
                lyrics={lyrics}
                duration={currentTrack.duration}
                isPlaying={isPlaying}
                immersive
                fontScale={lyricsFontScale}
                align={lyricsAlign}
                showTranslatedLyrics={showTranslatedLyrics}
                showRomanizedLyrics={showRomanizedLyrics}
                className="h-full"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-white/70">
                {currentTrack.title} 暂无可用歌词
              </div>
            )}
          </section>
        </div>

        {/* Queue panel */}
        {queueOpen && currentTrack ? (
          <motion.div
            className="absolute inset-0 z-40 flex justify-end"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            <button
              type="button"
              aria-label="close-queue-overlay"
              onClick={() => setQueueOpen(false)}
              className="h-full flex-1 bg-black/40"
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 20 }}
              className="flex h-full w-full max-w-[22.5rem] flex-col border-l border-white/20 bg-black/45 p-4 pt-16 backdrop-blur-2xl sm:max-w-[25rem]"
            >
              <div className="mb-4 flex items-center justify-between text-white">
                <h3 className="text-base font-semibold">下一首播放</h3>
                <button
                  type="button"
                  aria-label="close-queue"
                  onClick={() => setQueueOpen(false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/10 transition-colors hover:bg-white/20"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-none">
                {queue.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-white/70">
                    当前队列为空
                  </div>
                ) : (
                  queue.map((track, index) => {
                    const active = track.id === currentTrack.id;

                    return (
                      <button
                        key={`${track.id}-${index}`}
                        type="button"
                        onClick={() => onSelectTrack(track.id)}
                        className={cn(
                          "mb-1.5 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-colors",
                          active
                            ? "bg-white/25 text-white"
                            : "bg-white/5 text-white/85 hover:bg-white/15",
                        )}
                      >
                        <div className="mr-3 min-w-0">
                          <p className="truncate text-sm font-medium">{track.title}</p>
                          {onArtistClick && track.artist?.trim() ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onArtistClick(track.artist.trim()); }}
                              className={cn("truncate text-xs transition-colors hover:text-[var(--accent-soft-strong)] hover:underline", active ? "text-white/80" : "text-white/55")}
                            >
                              {track.artist}
                            </button>
                          ) : (
                            <p className={cn("truncate text-xs", active ? "text-white/80" : "text-white/55")}>
                              {track.artist}
                            </p>
                          )}
                        </div>
                        <span className={cn("text-xs", active ? "text-white/75" : "text-white/50")}>
                          {formatTime(track.duration)}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </motion.aside>
          </motion.div>
        ) : null}
      </div>
    </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
