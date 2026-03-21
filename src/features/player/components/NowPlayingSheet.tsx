import { motion } from "framer-motion";
import { ListMusic, Loader2, Music4, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { LyricsData } from "@/lib/api/subsonic-client";
import { useDominantColor } from "@/hooks/use-dominant-color";
import { cn } from "@/lib/utils";
import type { TrackInfo } from "@/stores/player-store";

import { AppleMusicLyrics } from "./AppleMusicLyrics";

type NowPlayingSheetProps = {
  open: boolean;
  currentTrack: TrackInfo | null;
  queue: TrackInfo[];
  progress: number;
  isPlaying: boolean;
  lyrics: LyricsData;
  lyricsLoading: boolean;
  highResCoverUrl?: string | null;
  onClose: () => void;
  onSelectTrack: (trackId: string) => void;
};

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
  progress,
  isPlaying,
  lyrics,
  lyricsLoading,
  highResCoverUrl,
  onClose,
  onSelectTrack,
}: NowPlayingSheetProps) {
  const hasLyrics = lyrics.text.trim().length > 0;
  const [queueOpen, setQueueOpen] = useState(false);
  const [highResLoaded, setHighResLoaded] = useState(false);
  const [highResLoadFailed, setHighResLoadFailed] = useState(false);
  const lowResCoverUrl = currentTrack?.coverUrl ?? null;
  const hasDedicatedHighResCover = Boolean(highResCoverUrl && highResCoverUrl !== lowResCoverUrl);
  const canUseHighResCover = hasDedicatedHighResCover && !highResLoadFailed;
  const showHighResCover = canUseHighResCover && highResLoaded;
  const displayCoverUrl = showHighResCover ? (highResCoverUrl ?? null) : lowResCoverUrl;
  const ambientColor = useDominantColor(displayCoverUrl);
  const fallbackBackdrop =
    "radial-gradient(circle at 20% 20%, rgba(16,185,129,0.25), transparent 42%), radial-gradient(circle at 80% 80%, rgba(59,130,246,0.22), transparent 45%)";

  useEffect(() => {
    if (!open) {
      setQueueOpen(false);
    }
  }, [open]);

  useEffect(() => {
    setQueueOpen(false);
  }, [currentTrack?.id]);

  useEffect(() => {
    if (!open || !hasDedicatedHighResCover || !highResCoverUrl) {
      setHighResLoaded(false);
      setHighResLoadFailed(false);
      return;
    }

    setHighResLoaded(false);
    setHighResLoadFailed(false);
    let disposed = false;
    const image = new Image();
    image.onload = () => {
      if (disposed) {
        return;
      }
      setHighResLoaded(true);
    };
    image.onerror = () => {
      if (disposed) {
        return;
      }
      setHighResLoadFailed(true);
    };
    image.src = highResCoverUrl;

    return () => {
      disposed = true;
    };
  }, [currentTrack?.id, hasDedicatedHighResCover, highResCoverUrl, open]);

  if (!open) {
    return null;
  }

  return (
    <motion.section
      role="dialog"
      aria-label="now-playing-sheet"
      initial={{ y: "105%" }}
      animate={{ y: 0 }}
      transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-0 z-[60] overflow-hidden"
    >
          <div className="absolute inset-0 scale-110">
            <div
              className={cn(
                "absolute inset-0 bg-cover bg-center blur-[56px] transition-opacity duration-500",
                showHighResCover && "opacity-0",
              )}
              style={{
                backgroundImage: lowResCoverUrl ? `url(${lowResCoverUrl})` : fallbackBackdrop,
              }}
            />
            {canUseHighResCover && highResCoverUrl ? (
              <div
                className={cn(
                  "absolute inset-0 bg-cover bg-center blur-[56px] transition-opacity duration-500",
                  showHighResCover ? "opacity-100" : "opacity-0",
                )}
                style={{
                  backgroundImage: `url(${highResCoverUrl})`,
                }}
              />
            ) : null}
          </div>
          <div
            className="absolute inset-0 opacity-75"
            style={{ background: `radial-gradient(circle at 16% 24%, ${ambientColor}, transparent 55%)` }}
          />
          <div className="absolute inset-0 bg-black/42 backdrop-blur-2xl" />
          <div className="absolute inset-0 bg-[linear-gradient(150deg,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0)_45%,rgba(0,0,0,0.15)_100%)]" />
          <div className="absolute inset-0 bg-black/20" />

          <div className="relative z-10 flex h-full min-h-0 flex-col">
            <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-white/35" />
            <div className="flex items-center justify-between px-5 py-4 text-white">
              <h2 className="text-lg font-semibold tracking-tight">正在播放</h2>
              <button
                type="button"
                aria-label="close-sheet"
                onClick={onClose}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 gap-4 px-4 pb-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-6 lg:px-7">
              <section className="min-h-0 px-2 pb-2 pt-1 text-white lg:px-4 lg:pb-5">
                {!currentTrack ? (
                  <div className="flex h-full items-center justify-center text-sm text-white/70">
                    还没有正在播放的歌曲
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-6">
                    <motion.div
                      animate={isPlaying
                        ? { scale: [1, 1.03, 1] }
                        : { scale: 1 }}
                      transition={{
                        duration: 3.6,
                        ease: "easeInOut",
                        repeat: isPlaying ? Number.POSITIVE_INFINITY : 0,
                      }}
                      className="relative w-full max-w-[20rem] sm:max-w-[23rem] lg:max-w-[26rem]"
                    >
                      <div className="aspect-square overflow-hidden rounded-3xl bg-white/10 shadow-[0_32px_90px_rgba(0,0,0,0.62)] ring-1 ring-white/15">
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
                    </motion.div>

                    <div className="w-full max-w-[27rem] text-center">
                      <p className="truncate text-[1.4rem] font-semibold tracking-tight sm:text-[1.6rem]">
                        {currentTrack.title}
                      </p>
                      <p className="mt-2 truncate text-[0.95rem] text-white/70 sm:text-base">
                        {currentTrack.artist}
                      </p>
                    </div>
                  </div>
                )}
              </section>

              <section className="min-h-0 px-2 pb-2 text-white lg:px-3 lg:pb-5">
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
                    progress={progress}
                    duration={currentTrack.duration}
                    isPlaying={isPlaying}
                    immersive
                    className="h-full"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-white/70">
                    {currentTrack.title} 暂无可用歌词
                  </div>
                )}
              </section>
            </div>

            {currentTrack ? (
              <button
                type="button"
                aria-label="toggle-queue"
                onClick={() => setQueueOpen((prev) => !prev)}
                className={cn(
                  "absolute bottom-5 right-5 z-30 inline-flex h-12 items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 text-sm text-white backdrop-blur-xl transition-colors hover:bg-white/20",
                  queueOpen && "bg-white/25",
                )}
              >
                <ListMusic className="h-4 w-4" />
                <span>队列</span>
                <span className="rounded-full bg-white/25 px-2 py-0.5 text-xs">{queue.length}</span>
              </button>
            ) : null}

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

                  <div className="min-h-0 flex-1 overflow-y-auto pr-1">
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
                              <p className={cn("truncate text-xs", active ? "text-white/80" : "text-white/55")}>
                                {track.artist}
                              </p>
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
  );
}
