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
  fontScale?: number;
  align?: "left" | "center";
  showTranslatedLyrics?: boolean;
  showRomanizedLyrics?: boolean;
  className?: string;
};

type LyricGlyph = {
  text: string;
  start: number;
  end: number;
  key: string;
};

type WaitingGapWindow = {
  start: number;
  end: number;
  duration: number;
};

const WAITING_GAP_THRESHOLD_SECONDS = 3.5;
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

function resolveWaitingGapWindow(
  gapAnchorKey: number,
  gapDuration: number,
  lines: TimedLyricLine[],
  trackDuration: number,
): WaitingGapWindow | null {
  if (gapAnchorKey === WAITING_GAP_START_KEY) {
    const firstLine = lines[0];
    if (!firstLine || !Number.isFinite(firstLine.start)) {
      return null;
    }

    const end = Math.max(0.05, firstLine.start);
    return { start: 0, end, duration: end };
  }

  const currentLine = lines[gapAnchorKey];
  if (!currentLine) {
    return null;
  }

  const start = resolveLineEnd(currentLine);
  const nextStart = lines[gapAnchorKey + 1]?.start;
  const boundedTrackDuration = Number.isFinite(trackDuration) && trackDuration > 0
    ? trackDuration
    : start + gapDuration;
  const endCandidate = Number.isFinite(nextStart) ? nextStart : boundedTrackDuration;
  const end = Math.max(start + 0.05, endCandidate);
  return {
    start,
    end,
    duration: Math.max(0.05, end - start),
  };
}

function hasCjkText(value: string) {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(value);
}

function hasLatinText(value: string) {
  return /[a-zA-Z]/.test(value);
}

function isLikelyTranslationLine(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  return /^(?:\[?(?:translation|translate|translated|译|翻译|译文|中文翻译)[:：\]\s])/i.test(normalized);
}

function isLikelyRomanizedLine(value: string, previousLine?: string, nextLine?: string) {
  const normalized = value.trim();
  if (!normalized || !hasLatinText(normalized) || hasCjkText(normalized)) {
    return false;
  }

  const aroundHasCjk = hasCjkText(previousLine ?? "") || hasCjkText(nextLine ?? "");
  return aroundHasCjk;
}

export function AppleMusicLyrics({
  lyrics,
  duration,
  isPlaying,
  immersive = false,
  fontScale = 1,
  align = "center",
  showTranslatedLyrics = true,
  showRomanizedLyrics = true,
  className,
}: AppleMusicLyricsProps) {
  // 是否拥有有效的时间轴
  const isTimed = useMemo(() => {
    return lyrics.timedLines && lyrics.timedLines.length > 0;
  }, [lyrics.timedLines]);

  // 核心歌词行数据
  const lyricLines = useMemo(() => {
    const baseLines = (() => {
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
    })();

    if (showTranslatedLyrics && showRomanizedLyrics) {
      return baseLines;
    }

    const filtered = baseLines.filter((line, index) => {
      const lineText = line.text.trim();
      if (!lineText) {
        return false;
      }

      if (!showTranslatedLyrics && isLikelyTranslationLine(lineText)) {
        return false;
      }

      if (!showRomanizedLyrics) {
        const previousLine = baseLines[index - 1]?.text;
        const nextLine = baseLines[index + 1]?.text;
        if (isLikelyRomanizedLine(lineText, previousLine, nextLine)) {
          return false;
        }
      }

      return true;
    });

    return filtered.length > 0 ? filtered : baseLines;
  }, [isTimed, lyrics.text, lyrics.timedLines, showRomanizedLyrics, showTranslatedLyrics]);

  const safeFontScale = useMemo(
    () => (Number.isFinite(fontScale) ? Math.max(0.8, Math.min(1.6, fontScale)) : 1),
    [fontScale],
  );

  const isLeftAligned = align === "left";

  const lineTextAlignClass = isLeftAligned ? "text-left" : "text-center";
  const lineContainerAlignClass = isLeftAligned ? "items-start" : "items-center";

  const lineTypographyScaleStyle = useMemo(
    () => (isTimed ? undefined : { fontSize: `${safeFontScale}em` }),
    [isTimed, safeFontScale],
  );

  const lineWrapperClassName = useMemo(
    () =>
      cn(
        "mx-auto flex w-full max-w-6xl flex-col",
        lineContainerAlignClass,
        immersive
          ? isTimed
            ? "space-y-6 lg:space-y-8"
            : "space-y-3 py-10"
          : isTimed
            ? "space-y-4"
            : "space-y-3 py-10",
      ),
    [immersive, isTimed, lineContainerAlignClass],
  );

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
  const [waitingGapTick, setWaitingGapTick] = useState(0);
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
  const waitingTimelineNow = useMemo(
    () => audioEngine.getCurrentTime(),
    [activeWaitingGapKey, waitingGapTick],
  );

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
      // 减去 0s 补偿，让歌词比原始时间轴稍微延迟一点点显示，以对齐听感
      const currentTime = audioEngine.getCurrentTime() - 0;
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
    if (!isTimed || activeWaitingGapKey === null || !isPlaying) {
      return;
    }

    const timer = window.setInterval(() => {
      setWaitingGapTick((value) => (value + 1) % 1_000_000);
    }, 85);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeWaitingGapKey, isPlaying, isTimed]);

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
    const waitingGapWindow = resolveWaitingGapWindow(gapAnchorKey, gapDuration, lyricLines, duration);
    const waitingProgress = isWaitingNow && waitingGapWindow
      ? Math.min(
          1,
          Math.max(0, (waitingTimelineNow - waitingGapWindow.start) / waitingGapWindow.duration),
        )
      : 0;
    const remainingSeconds = isWaitingNow && waitingGapWindow
      ? Math.max(0, waitingGapWindow.end - waitingTimelineNow)
      : gapDuration;
    const urgency = isWaitingNow && waitingGapWindow
      ? Math.min(1, Math.max(0, 1 - remainingSeconds / waitingGapWindow.duration))
      : 0;

    const compactGapWeight = Math.sqrt(Math.max(0, gapDuration));
    const spacerHeight = immersive
      ? Math.min(72, 12 + compactGapWeight * 14)
      : Math.min(58, 10 + compactGapWeight * 11);

    return (
      <motion.div
        key={`waiting-gap-${gapAnchorKey}`}
        aria-hidden="true"
        className="pointer-events-none flex items-center justify-center"
        style={{ height: spacerHeight }}
        animate={{
          opacity: isWaitingNow ? 0.96 : 0,
          scale: isWaitingNow ? 1 : 0.98,
          y: isWaitingNow ? 0 : 6,
          filter: isWaitingNow ? "blur(0px)" : "blur(1px)",
        }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      >
        {[0, 1, 2].map((dotIndex) => {
          const dotCountdownProgress = Math.min(1, Math.max(0, waitingProgress * 3 - dotIndex));
          const dotPop = Math.sin(dotCountdownProgress * Math.PI);
          const dotOpacity = isWaitingNow
            ? 0.18 + dotCountdownProgress * 0.66 + dotPop * 0.16
            : 0;
          const dotScale = isWaitingNow
            ? 0.86 + dotCountdownProgress * 0.3 + dotPop * (0.2 + urgency * 0.16)
            : 0.9;
          const dotOffsetY = isWaitingNow ? -dotPop * (2.6 + urgency * 3) : 0;

          return (
            <motion.span
              key={`${gapAnchorKey}-dot-${dotIndex}`}
              className={cn(
                "mx-1.5 inline-block rounded-full",
                immersive ? "h-2.5 w-2.5 bg-white/85" : "h-2 w-2 bg-slate-500/80 dark:bg-slate-200/80",
              )}
              animate={{ opacity: dotOpacity, scale: dotScale, y: dotOffsetY }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              style={
                immersive && isWaitingNow
                  ? {
                      boxShadow: `0 0 ${6 + urgency * 10}px rgba(255,255,255,${0.12 + dotCountdownProgress * 0.24})`,
                    }
                  : undefined
              }
            />
          );
        })}
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
        className={lineWrapperClassName}
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
          const nonActiveBaseScale = immersive ? 0.9 : 0.92;
          const nonActiveMinScale = immersive ? 0.7 : 0.76;
          const nonActiveDecay = immersive ? 0.04 : 0.035;
          const nonActiveScale = Math.max(
            nonActiveMinScale,
            nonActiveBaseScale - distanceLevel * nonActiveDecay,
          );
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
            "w-full max-w-4xl bg-transparent p-0 transition-[color,opacity,filter] duration-300 will-change-transform",
            isLeftAligned ? "mx-0" : "mx-auto",
            lineTextAlignClass,
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
              style={lineTypographyScaleStyle}
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
              style={lineTypographyScaleStyle}
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
