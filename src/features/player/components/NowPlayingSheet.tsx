import { AnimatePresence, motion } from "framer-motion";
import {
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
  type MouseEvent,
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

import { AppleMusicLyrics } from "./AppleMusicLyrics";

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
  const fillRef = useRef<HTMLSpanElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);

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

  const handleSeek = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      if (!currentTrack?.streamUrl) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (bounds.width <= 0) return;
      const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
      const seconds = ratio * duration;
      setProgress(seconds);
      void audioEngine.seek(seconds);
      const pct = (seconds / duration) * 100;
      if (fillRef.current) fillRef.current.style.width = `${pct}%`;
      if (thumbRef.current) thumbRef.current.style.left = `calc(${pct}% - 5px)`;
      if (timeRef.current) timeRef.current.textContent = formatTime(seconds);
    },
    [currentTrack?.streamUrl, duration, setProgress],
  );

  // RAF loop for smooth progress updates
  useEffect(() => {
    if (!isPlaying || !open) return;
    let frameId = 0;
    const tick = () => {
      const t = Math.min(audioEngine.getCurrentTime(), duration);
      const pct = (t / duration) * 100;
      if (fillRef.current) fillRef.current.style.width = `${pct}%`;
      if (thumbRef.current) thumbRef.current.style.left = `calc(${pct}% - 5px)`;
      if (timeRef.current) timeRef.current.textContent = formatTime(t);
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying, open, duration]);

  // Reset progress display on track change
  useEffect(() => {
    if (!open) return;
    const t = Math.min(audioEngine.getCurrentTime(), duration);
    const pct = (t / duration) * 100;
    if (fillRef.current) fillRef.current.style.width = `${pct}%`;
    if (thumbRef.current) thumbRef.current.style.left = `calc(${pct}% - 5px)`;
    if (timeRef.current) timeRef.current.textContent = formatTime(t);
  }, [currentTrack?.id, duration, open]);

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

  const infoChips: string[] = [];
  if (currentTrack?.suffix) infoChips.push(currentTrack.suffix.toUpperCase());
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
      transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-0 z-[60] overflow-hidden"
    >
      {/* Background layers */}
      <div className="absolute inset-0 scale-110">
        <div
          className={cn(
            "absolute inset-0 bg-cover bg-center transition-opacity duration-500",
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
              "absolute inset-0 bg-cover bg-center transition-opacity duration-500",
              backgroundBlurEnabled ? "blur-[56px]" : "blur-none",
              showHighResCover ? "opacity-100" : "opacity-0",
            )}
            style={{ backgroundImage: `url(${highResCoverUrl})` }}
          />
        ) : null}
      </div>
      <div
        className="absolute inset-0 opacity-75"
        style={{ background: `radial-gradient(circle at 16% 24%, ${ambientColor}, transparent 55%)` }}
      />
      <div
        className={cn(
          "absolute inset-0 bg-black/42",
          backgroundBlurEnabled ? "backdrop-blur-2xl" : "backdrop-blur-none",
        )}
      />
      <div className="absolute inset-0 bg-[linear-gradient(150deg,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0)_45%,rgba(0,0,0,0.15)_100%)]" />
      <div className="absolute inset-0 bg-black/20" />

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
                    type="button"
                    aria-label="seek-progress"
                    disabled={!currentTrack.streamUrl}
                    onClick={handleSeek}
                    className="relative h-4 flex-1 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/25" />
                    <span
                      ref={fillRef}
                      className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/90"
                    />
                    <span
                      ref={thumbRef}
                      className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-white shadow-sm"
                    />
                  </button>
                  <span className="w-9 text-[11px] tabular-nums text-white/60">
                    {formatTime(duration)}
                  </span>
                </div>

                {/* Control buttons */}
                <div className="flex items-center gap-5">
                  <button
                    type="button"
                    aria-label="shuffle"
                    onClick={toggleShuffle}
                    disabled={queue.length <= 1}
                    className={cn(
                      "inline-flex h-10 w-10 items-center justify-center rounded-full transition-all disabled:opacity-30",
                      shuffle
                        ? "text-white bg-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
                        : "text-white/55 hover:text-white/80",
                    )}
                  >
                    <Shuffle className="h-[18px] w-[18px]" />
                  </button>
                  <button
                    type="button"
                    aria-label="previous"
                    onClick={handlePlayPrevious}
                    disabled={queue.length === 0}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full text-white/85 transition-all hover:text-white hover:bg-white/10 active:scale-90 disabled:opacity-30"
                  >
                    <SkipBack className="h-[22px] w-[22px] fill-current" />
                  </button>
                  <button
                    type="button"
                    aria-label="play-pause"
                    onClick={() => void handleTogglePlay()}
                    disabled={!currentTrack.streamUrl}
                    className="group relative inline-flex h-[56px] w-[56px] items-center justify-center rounded-full bg-white/95 text-black/85 shadow-[0_4px_24px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-sm transition-all duration-200 hover:bg-white hover:shadow-[0_6px_32px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,1)] hover:scale-105 active:scale-[0.92] active:shadow-[0_2px_12px_rgba(0,0,0,0.25)] disabled:opacity-30"
                  >
                    {isPlaying ? (
                      <Pause className="h-6 w-6 fill-current" />
                    ) : (
                      <Play className="h-6 w-6 translate-x-[1.5px] fill-current" />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label="next"
                    onClick={handlePlayNext}
                    disabled={queue.length === 0}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full text-white/85 transition-all hover:text-white hover:bg-white/10 active:scale-90 disabled:opacity-30"
                  >
                    <SkipForward className="h-[22px] w-[22px] fill-current" />
                  </button>
                  <button
                    type="button"
                    aria-label="repeat"
                    onClick={handleRepeatToggle}
                    className={cn(
                      "inline-flex h-10 w-10 items-center justify-center rounded-full transition-all",
                      repeatMode !== "off"
                        ? "text-white bg-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
                        : "text-white/55 hover:text-white/80",
                    )}
                  >
                    {repeatMode === "one" ? <Repeat1 className="h-[18px] w-[18px]" /> : <Repeat2 className="h-[18px] w-[18px]" />}
                  </button>
                </div>

                {/* Song info chips */}
                {infoChips.length > 0 ? (
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {infoChips.map((chip) => (
                      <span
                        key={chip}
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
            transition={{ duration: 0.2, ease: "easeOut" }}
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
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
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
