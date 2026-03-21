import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  LyricsData,
  TimedLyricLine,
  TimedLyricSyllable,
} from "@/lib/api/subsonic-client";
import { audioEngine } from "@/lib/audio/AudioEngine";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

type AppleMusicLyricsProps = {
  lyrics: LyricsData;
  duration: number;
  isPlaying: boolean;
  immersive?: boolean;
  className?: string;
};

type LyricGlyph = {
  text: string;
  start: number;
  end: number;
  key: string;
};

const WAITING_GAP_THRESHOLD_SECONDS = 3.6;
const WAITING_GAP_START_KEY = -1;
const AUTO_FOLLOW_RESUME_DELAY_MS = 2500;

function expandSyllablesToGlyphs(
  syllables: TimedLyricSyllable[],
  lineIndex: number,
): LyricGlyph[] {
  if (!syllables || syllables.length === 0) {
    return [];
  }

  return syllables
    .map((syllable, syllableIndex) => ({
      text: syllable.text,
      start: syllable.start,
      end: syllable.end,
      key: `${lineIndex}-${syllableIndex}`,
    }))
    .filter((glyph) => glyph.text.length > 0 && glyph.end > glyph.start);
}

function buildLineGlyphs(line: TimedLyricLine, lineIndex: number): LyricGlyph[] {
  const syllableGlyphs = expandSyllablesToGlyphs(line.syllables, lineIndex);
  if (syllableGlyphs.length > 0) {
    return syllableGlyphs;
  }

  return [
    {
      text: line.text,
      start: line.start,
      end: line.end,
      key: `${lineIndex}-line`,
    },
  ];
}

function resolveActiveLineIndex(lines: TimedLyricLine[], currentTime: number) {
  if (!lines || lines.length === 0) {
    return -1;
  }

  const safeTime = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
  let left = 0;
  let right = lines.length - 1;
  let candidate = -1;

  while (left <= right) {
    const middle = (left + right) >> 1;
    const lineStart = lines[middle]?.start ?? 0;

    if (lineStart <= safeTime) {
      candidate = middle;
      left = middle + 1;
    } else {
      right = middle - 1;
    }
  }

  return candidate;
}

function resolveLineEnd(line: TimedLyricLine) {
  const safeStart = Number.isFinite(line.start) ? Math.max(0, line.start) : 0;
  const safeEnd = Number.isFinite(line.end) ? line.end : safeStart;
  return safeEnd > safeStart ? safeEnd : safeStart;
}

export function AppleMusicLyrics({
  lyrics,
  duration,
  isPlaying,
  immersive = false,
  className,
}: AppleMusicLyricsProps) {
  // 是否拥有有效的时间轴
  const isTimed = useMemo(() => {
    return lyrics.timedLines && lyrics.timedLines.length > 0;
  }, [lyrics.timedLines]);

  // 核心歌词行数据
  const lyricLines = useMemo(() => {
    if (isTimed) {
      return lyrics.timedLines;
    }

    // 如果没有时间轴，则只是简单展示纯文本行，时间设为正无穷
    return lyrics.text
      .split(/\r?\n/)
      .map((line) => ({
        text: line.trim(),
        start: Number.POSITIVE_INFINITY,
        end: Number.POSITIVE_INFINITY,
        syllables: [],
      }))
      .filter((l) => l.text.length > 0);
  }, [isTimed, lyrics.text, lyrics.timedLines]);

  const lineGlyphs = useMemo(
    () => lyricLines.map((line, index) => buildLineGlyphs(line, index)),
    [lyricLines],
  );

  const waitingGapDurations = useMemo(() => {
    const gapMap = new Map<number, number>();
    if (!isTimed || lyricLines.length === 0) {
      return gapMap;
    }

    const firstLine = lyricLines[0];
    if (firstLine && Number.isFinite(firstLine.start) && firstLine.start >= WAITING_GAP_THRESHOLD_SECONDS) {
      gapMap.set(WAITING_GAP_START_KEY, firstLine.start);
    }

    for (let index = 0; index < lyricLines.length - 1; index += 1) {
      const currentLine = lyricLines[index];
      const nextLine = lyricLines[index + 1];
      if (!currentLine || !nextLine || !Number.isFinite(nextLine.start)) {
        continue;
      }

      const gapDuration = nextLine.start - resolveLineEnd(currentLine);
      if (gapDuration >= WAITING_GAP_THRESHOLD_SECONDS) {
        gapMap.set(index, gapDuration);
      }
    }

    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
    const lastLine = lyricLines[lyricLines.length - 1];
    if (safeDuration > 0 && lastLine) {
      const tailGapDuration = safeDuration - resolveLineEnd(lastLine);
      if (tailGapDuration >= WAITING_GAP_THRESHOLD_SECONDS) {
        gapMap.set(lyricLines.length - 1, tailGapDuration);
      }
    }

    return gapMap;
  }, [duration, isTimed, lyricLines]);

  const [activeLineIndex, setActiveLineIndex] = useState(-1);
  const [clickPulseLineIndex, setClickPulseLineIndex] = useState(-1);
  const [centerViewportPadding, setCenterViewportPadding] = useState(0);
  const [activeWaitingGapKey, setActiveWaitingGapKey] = useState<number | null>(null);
  const [isAutoFollowEnabled, setIsAutoFollowEnabled] = useState(true);
  const activeLineIndexRef = useRef(-1);
  const activeWaitingGapKeyRef = useRef<number | null>(null);
  const lineRefs = useRef<Array<HTMLElement | null>>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollAnimationFrameRef = useRef(0);
  const programmaticScrollReleaseFrameRef = useRef(0);
  const manualScrollResumeTimerRef = useRef<number | null>(null);
  const isProgrammaticScrollRef = useRef(false);
  const pendingClickSeekRef = useRef(false);
  const setProgress = usePlayerStore((state) => state.setProgress);

  const clearManualScrollResumeTimer = () => {
    if (manualScrollResumeTimerRef.current !== null) {
      window.clearTimeout(manualScrollResumeTimerRef.current);
      manualScrollResumeTimerRef.current = null;
    }
  };

  const queueAutoFollowResume = () => {
    clearManualScrollResumeTimer();
    manualScrollResumeTimerRef.current = window.setTimeout(() => {
      manualScrollResumeTimerRef.current = null;
      setIsAutoFollowEnabled(true);
    }, AUTO_FOLLOW_RESUME_DELAY_MS);
  };

  const pauseAutoFollowByUserScroll = () => {
    if (scrollAnimationFrameRef.current) {
      cancelAnimationFrame(scrollAnimationFrameRef.current);
      scrollAnimationFrameRef.current = 0;
    }

    if (programmaticScrollReleaseFrameRef.current) {
      cancelAnimationFrame(programmaticScrollReleaseFrameRef.current);
      programmaticScrollReleaseFrameRef.current = 0;
    }

    isProgrammaticScrollRef.current = false;
    pendingClickSeekRef.current = false;
    setIsAutoFollowEnabled(false);
    queueAutoFollowResume();
  };

  const releaseProgrammaticScrollLock = () => {
    if (programmaticScrollReleaseFrameRef.current) {
      cancelAnimationFrame(programmaticScrollReleaseFrameRef.current);
    }
    programmaticScrollReleaseFrameRef.current = requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = false;
      programmaticScrollReleaseFrameRef.current = 0;
    });
  };

  const markProgrammaticScroll = () => {
    if (programmaticScrollReleaseFrameRef.current) {
      cancelAnimationFrame(programmaticScrollReleaseFrameRef.current);
      programmaticScrollReleaseFrameRef.current = 0;
    }
    isProgrammaticScrollRef.current = true;
  };

  const handleManualScrollIntent = () => {
    if (!isTimed) {
      return;
    }

    pauseAutoFollowByUserScroll();
  };

  const handleContainerScroll = () => {
    if (!isTimed || isProgrammaticScrollRef.current) {
      return;
    }

    pauseAutoFollowByUserScroll();
  };

  const handleSeekByLyricLine = (lineIndex: number) => {
    if (!isTimed) {
      return;
    }

    const line = lyricLines[lineIndex];
    const rawStart = line?.start ?? 0;
    if (!Number.isFinite(rawStart)) {
      return;
    }

    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
    const targetSeconds = Math.max(0, Math.min(rawStart, safeDuration));

    clearManualScrollResumeTimer();
    setIsAutoFollowEnabled(true);
    pendingClickSeekRef.current = true;
    setClickPulseLineIndex(lineIndex);
    activeLineIndexRef.current = lineIndex;
    setActiveLineIndex(lineIndex);
    setProgress(targetSeconds);
    void audioEngine.seek(targetSeconds).catch((error) => {
      console.error("seek by lyric line failed", error);
    });
  };

  // 进度同步逻辑（仅在有时轴时运行）
  useEffect(() => {
    if (!isTimed) {
      clearManualScrollResumeTimer();
      setIsAutoFollowEnabled(true);
      setActiveLineIndex(-1);
      setActiveWaitingGapKey(null);
      return;
    }

    let frameId = 0;
    clearManualScrollResumeTimer();
    setIsAutoFollowEnabled(true);
    activeLineIndexRef.current = -1;
    activeWaitingGapKeyRef.current = null;
    setActiveLineIndex(-1);
    setActiveWaitingGapKey(null);

    const syncActiveLine = () => {
      // 减去 0.5s 补偿，让歌词比原始时间轴稍微延迟一点点显示，以对齐听感
      const currentTime = audioEngine.getCurrentTime() - 0.5;
      const nextLineIndex = resolveActiveLineIndex(lyricLines, currentTime);
      let nextWaitingGapKey: number | null = null;

      if (waitingGapDurations.has(WAITING_GAP_START_KEY)) {
        const firstLine = lyricLines[0];
        if (firstLine && currentTime >= 0 && currentTime < firstLine.start) {
          nextWaitingGapKey = WAITING_GAP_START_KEY;
        }
      }

      if (nextWaitingGapKey === null && nextLineIndex >= 0) {
        const currentLine = lyricLines[nextLineIndex];
        const nextLine = lyricLines[nextLineIndex + 1];

        if (currentLine && waitingGapDurations.has(nextLineIndex)) {
          const currentLineEnd = resolveLineEnd(currentLine);
          if (nextLine) {
            if (currentTime >= currentLineEnd && currentTime < nextLine.start) {
              nextWaitingGapKey = nextLineIndex;
            }
          } else if (currentTime >= currentLineEnd) {
            nextWaitingGapKey = nextLineIndex;
          }
        }
      }

      if (nextLineIndex !== activeLineIndexRef.current) {
        activeLineIndexRef.current = nextLineIndex;
        setActiveLineIndex(nextLineIndex);
      }

      if (nextWaitingGapKey !== activeWaitingGapKeyRef.current) {
        activeWaitingGapKeyRef.current = nextWaitingGapKey;
        setActiveWaitingGapKey(nextWaitingGapKey);
      }

      frameId = requestAnimationFrame(syncActiveLine);
    };

    frameId = requestAnimationFrame(syncActiveLine);

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [isTimed, lyricLines, waitingGapDurations]);

  useEffect(() => {
    if (lyricLines.length === 0) {
      lineRefs.current = [];
      return;
    }

    lineRefs.current = lineRefs.current.slice(0, lyricLines.length);
  }, [lyricLines.length]);

  useEffect(() => {
    if (clickPulseLineIndex < 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setClickPulseLineIndex(-1);
    }, 560);

    return () => {
      window.clearTimeout(timer);
    };
  }, [clickPulseLineIndex]);

  useEffect(() => {
    return () => {
      if (scrollAnimationFrameRef.current) {
        cancelAnimationFrame(scrollAnimationFrameRef.current);
      }
      if (programmaticScrollReleaseFrameRef.current) {
        cancelAnimationFrame(programmaticScrollReleaseFrameRef.current);
      }
      clearManualScrollResumeTimer();
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updatePadding = () => {
      setCenterViewportPadding(Math.max(0, Math.round(container.clientHeight * 0.5)));
    };

    updatePadding();

    const observer = new ResizeObserver(() => {
      updatePadding();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  // 滚动控制（仅在有时轴时自动滚动）
  useEffect(() => {
    if (!isTimed || activeLineIndex < 0 || !isAutoFollowEnabled) {
      return;
    }

    const container = containerRef.current;
    const node = lineRefs.current[activeLineIndex];
    if (!container || !node) {
      return;
    }

    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const targetScrollTop = Math.min(
      Math.max(0, node.offsetTop - container.clientHeight / 2 + node.clientHeight / 2),
      maxScrollTop,
    );

    const shouldUseClickAnimation = pendingClickSeekRef.current;
    const shouldAnimate = shouldUseClickAnimation || isPlaying;

    if (scrollAnimationFrameRef.current) {
      cancelAnimationFrame(scrollAnimationFrameRef.current);
      scrollAnimationFrameRef.current = 0;
    }

    if (!shouldAnimate) {
      markProgrammaticScroll();
      container.scrollTop = targetScrollTop;
      releaseProgrammaticScrollLock();
      pendingClickSeekRef.current = false;
      return;
    }

    const startScrollTop = container.scrollTop;
    const delta = targetScrollTop - startScrollTop;

    if (Math.abs(delta) < 1) {
      markProgrammaticScroll();
      container.scrollTop = targetScrollTop;
      releaseProgrammaticScrollLock();
      pendingClickSeekRef.current = false;
      return;
    }

    const animationDuration = shouldUseClickAnimation ? 520 : 340;
    const animationStart = performance.now();
    const ease = shouldUseClickAnimation
      ? (t: number) => 1 - Math.pow(1 - t, 4)
      : (t: number) => 1 - Math.pow(1 - t, 3);

    markProgrammaticScroll();

    const animateScroll = (now: number) => {
      const elapsed = now - animationStart;
      const progress = Math.min(1, elapsed / animationDuration);
      container.scrollTop = startScrollTop + delta * ease(progress);

      if (progress < 1) {
        scrollAnimationFrameRef.current = requestAnimationFrame(animateScroll);
        return;
      }

      pendingClickSeekRef.current = false;
      scrollAnimationFrameRef.current = 0;
      releaseProgrammaticScrollLock();
    };

    scrollAnimationFrameRef.current = requestAnimationFrame(animateScroll);
  }, [activeLineIndex, centerViewportPadding, isAutoFollowEnabled, isPlaying, isTimed]);

  const renderWaitingDots = (gapAnchorKey: number, gapDuration: number) => {
    const isWaitingNow = activeWaitingGapKey === gapAnchorKey;
    const spacerHeight = immersive
      ? Math.min(152, 24 + gapDuration * 11)
      : Math.min(126, 20 + gapDuration * 9);

    return (
      <motion.div
        key={`waiting-gap-${gapAnchorKey}`}
        aria-hidden="true"
        className="pointer-events-none flex items-center justify-center"
        style={{ height: spacerHeight }}
        animate={{
          opacity: isWaitingNow ? 0.95 : 0.45,
          scale: isWaitingNow ? 1 : 0.94,
          filter: isAutoFollowEnabled
            ? isWaitingNow
              ? "blur(0px)"
              : "blur(0.5px)"
            : "blur(0px)",
        }}
        transition={{ duration: 0.3, ease: [0.25, 1, 0.5, 1] }}
      >
        {[0, 1, 2].map((dotIndex) => (
          <motion.span
            key={`${gapAnchorKey}-dot-${dotIndex}`}
            className={cn(
              "mx-1 inline-block rounded-full",
              immersive ? "h-1.5 w-1.5 bg-white/80" : "h-1.5 w-1.5 bg-slate-500/75 dark:bg-slate-300/70",
            )}
            animate={
              isWaitingNow
                ? { y: [0, -3, 0], opacity: [0.35, 1, 0.35] }
                : { y: 0, opacity: 0.6 }
            }
            transition={
              isWaitingNow
                ? { duration: 1.1, ease: "easeInOut", repeat: Number.POSITIVE_INFINITY, delay: dotIndex * 0.14 }
                : { duration: 0.22, ease: "easeOut" }
            }
          />
        ))}
      </motion.div>
    );
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleContainerScroll}
      onWheel={handleManualScrollIntent}
      onTouchMove={handleManualScrollIntent}
      className={cn(
        "h-full overflow-y-auto scrollbar-none",
        immersive
          ? "px-4 py-4 sm:px-8 sm:py-6 lg:px-12 lg:py-8"
          : "rounded-2xl border border-slate-200/80 bg-white/70 px-5 py-6 dark:border-slate-800/80 dark:bg-slate-950/65",
        className,
      )}
    >
      <div
        className={cn(
          "mx-auto flex w-full max-w-6xl flex-col items-center",
          immersive
            ? isTimed
              ? "space-y-6 lg:space-y-8"
              : "space-y-3 py-10"
            : isTimed
              ? "space-y-4"
              : "space-y-3 py-10",
        )}
        style={isTimed ? { paddingTop: centerViewportPadding, paddingBottom: centerViewportPadding } : undefined}
      >
        {isTimed && waitingGapDurations.has(WAITING_GAP_START_KEY)
          ? renderWaitingDots(WAITING_GAP_START_KEY, waitingGapDurations.get(WAITING_GAP_START_KEY) ?? WAITING_GAP_THRESHOLD_SECONDS)
          : null}
        {lyricLines.map((line, lineIndex) => {
          const isActiveLine = lineIndex === activeLineIndex;
          const isPastLine = activeLineIndex >= 0 && lineIndex < activeLineIndex;
          const glyphs = lineGlyphs[lineIndex] ?? [];
          const canSeek = isTimed && Number.isFinite(line.start);
          const shouldPulseOnActivate = clickPulseLineIndex === lineIndex && isActiveLine;
          const activeScale = immersive ? 1.04 : 1.03;
          const lineDistance = activeLineIndex >= 0 ? Math.abs(lineIndex - activeLineIndex) : 0;
          const distanceLevel = Math.min(lineDistance, 8);
          const nonActiveScale = immersive
            ? Math.max(0.78, 1 - distanceLevel * 0.035)
            : Math.max(0.82, 1 - distanceLevel * 0.03);
          const lineScale = isTimed ? (isActiveLine ? activeScale : nonActiveScale) : 1;
          const lineBlur = isTimed && isAutoFollowEnabled && !isActiveLine
            ? Math.min(immersive ? 5.4 : 4.2, distanceLevel * (immersive ? 0.9 : 0.72))
            : 0;
          const lineAnimation =
            isActiveLine && shouldPulseOnActivate
              ? {
                  scale: [1, activeScale + 0.04, activeScale],
                  y: [14, 0],
                  filter: ["blur(2.4px)", "blur(0px)", "blur(0px)"],
                }
              : {
                  scale: lineScale,
                  y: 0,
                  filter: `blur(${lineBlur.toFixed(2)}px)`,
                };
          const lineTransition = shouldPulseOnActivate
            ? { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const }
            : { duration: 0.3, ease: [0.25, 1, 0.5, 1] as const };
          const lineClassName = cn(
            "mx-auto w-full max-w-4xl bg-transparent p-0 text-center transition-[color,opacity,filter] duration-300 will-change-transform",
            // 沉浸模式样式
            immersive && [
              isTimed
                ? "text-[clamp(1.9rem,3.05vw,3rem)] font-bold leading-[1.24] tracking-tight"
                : "text-[1.2rem] font-medium leading-[1.6] text-white/80", // 非时轴模式变小
              isTimed &&
                (isActiveLine
                  ? "opacity-100 text-white"
                  : isPastLine
                    ? "opacity-45 text-white/60"
                    : "opacity-55 text-white/70"),
            ],
            // 普通模式样式
            !immersive && [
              isTimed
                ? "text-[1.45rem] font-semibold leading-[1.45] tracking-tight"
                : "text-[1.1rem] font-normal leading-[1.6] text-slate-600 dark:text-slate-400", // 非时轴模式变小
              isTimed &&
                (isActiveLine
                  ? "text-slate-900 opacity-100 dark:text-white"
                  : isPastLine
                    ? "text-slate-700/75 opacity-60 dark:text-slate-300/75"
                    : "text-slate-400 opacity-60 dark:text-slate-500"),
            ],
            canSeek
              ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/45"
              : "cursor-default",
            canSeek && !isActiveLine && (immersive ? "hover:text-white/90" : "hover:text-slate-500 dark:hover:text-slate-300"),
          );
          const lineContent = glyphs.map((glyph) => {
            return (
              <span
                key={glyph.key}
                className={cn(
                  "inline-block whitespace-pre-wrap transition-colors duration-300",
                  immersive
                    ? "text-current"
                    : isTimed && isActiveLine
                      ? "text-slate-900 dark:text-slate-100"
                      : "text-inherit",
                )}
              >
                {glyph.text}
              </span>
            );
          });

          const lineNode = canSeek ? (
            <motion.button
              type="button"
              key={`${line.start}-${lineIndex}`}
              onClick={() => {
                handleSeekByLyricLine(lineIndex);
              }}
              ref={(node) => {
                lineRefs.current[lineIndex] = node;
              }}
              animate={lineAnimation}
              transition={lineTransition}
              whileTap={{ scale: Math.max(0.94, lineScale - 0.03) }}
              className={lineClassName}
            >
              {lineContent}
            </motion.button>
          ) : (
            <motion.p
              key={`${line.start}-${lineIndex}`}
              ref={(node) => {
                lineRefs.current[lineIndex] = node;
              }}
              animate={lineAnimation}
              transition={lineTransition}
              className={lineClassName}
            >
              {lineContent}
            </motion.p>
          );

          const gapDuration = waitingGapDurations.get(lineIndex);
          if (!isTimed || gapDuration === undefined) {
            return lineNode;
          }

          return [lineNode, renderWaitingDots(lineIndex, gapDuration)];
        })}
      </div>
    </div>
  );
}
