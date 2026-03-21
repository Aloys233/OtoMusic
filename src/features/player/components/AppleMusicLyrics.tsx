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

  const [activeLineIndex, setActiveLineIndex] = useState(-1);
  const activeLineIndexRef = useRef(-1);
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const setProgress = usePlayerStore((state) => state.setProgress);

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
      setActiveLineIndex(-1);
      return;
    }

    let frameId = 0;
    activeLineIndexRef.current = -1;
    setActiveLineIndex(-1);

    const syncActiveLine = () => {
      const currentTime = audioEngine.getCurrentTime();
      const nextLineIndex = resolveActiveLineIndex(lyricLines, currentTime);

      if (nextLineIndex !== activeLineIndexRef.current) {
        activeLineIndexRef.current = nextLineIndex;
        setActiveLineIndex(nextLineIndex);
      }

      frameId = requestAnimationFrame(syncActiveLine);
    };

    frameId = requestAnimationFrame(syncActiveLine);

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [isTimed, lyricLines]);

  // 滚动控制（仅在有时轴时自动滚动）
  useEffect(() => {
    if (!isTimed || activeLineIndex < 0) {
      return;
    }

    const node = lineRefs.current[activeLineIndex];
    if (node) {
      node.scrollIntoView({
        block: "center",
        behavior: isPlaying ? "smooth" : "auto",
      });
    }
  }, [activeLineIndex, isPlaying, isTimed]);

  return (
    <div
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
          immersive
            ? isTimed
              ? "space-y-6 py-48 lg:space-y-8 lg:py-64"
              : "space-y-3 py-10"
            : "space-y-4 py-32",
        )}
      >
        {lyricLines.map((line, lineIndex) => {
          const isActiveLine = lineIndex === activeLineIndex;
          const isPastLine = activeLineIndex >= 0 && lineIndex < activeLineIndex;
          const glyphs = lineGlyphs[lineIndex] ?? [];
          const canSeek = isTimed && Number.isFinite(line.start);
          const lineClassName = cn(
            "w-full bg-transparent p-0 text-left transition-all duration-500 will-change-transform",
            // 沉浸模式样式
            immersive && [
              isTimed
                ? "text-[clamp(1.9rem,3.05vw,3rem)] font-bold leading-[1.24] tracking-tight"
                : "text-[1.2rem] font-medium leading-[1.6] text-white/80", // 非时轴模式变小
              isTimed &&
                (isActiveLine
                  ? "scale-105 opacity-100 blur-0 text-white"
                  : isPastLine
                    ? "scale-95 opacity-35 blur-[1px] text-white"
                    : "scale-95 opacity-45 blur-0 text-white"),
            ],
            // 普通模式样式
            !immersive && [
              isTimed
                ? "text-[1.45rem] font-semibold leading-[1.45] tracking-tight"
                : "text-[1.1rem] font-normal leading-[1.6] text-slate-600 dark:text-slate-400", // 非时轴模式变小
              isTimed &&
                (isActiveLine
                  ? "text-slate-900 scale-100 opacity-100 dark:text-white"
                  : isPastLine
                    ? "text-slate-700/75 scale-[0.98] opacity-60 dark:text-slate-300/75"
                    : "text-slate-400 scale-[0.98] opacity-50 dark:text-slate-500"),
            ],
            canSeek
              ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/45"
              : "cursor-default",
            canSeek && !isActiveLine && (immersive ? "hover:text-white/90" : "hover:text-slate-300"),
          );
          const lineContent = glyphs.map((glyph) => {
            const state = isActiveLine && isPlaying ? "active" : "idle";

            return (
              <motion.span
                key={glyph.key}
                variants={{
                  idle: { y: 0 },
                  active: immersive
                    ? { y: [0, -2, 0] }
                    : { y: [0, -4, 0] },
                }}
                animate={isTimed ? state : "idle"}
                transition={
                  state === "active"
                    ? { duration: 0.3, ease: "easeOut" }
                    : { duration: 0.2 }
                }
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
              </motion.span>
            );
          });

          if (canSeek) {
            return (
              <button
                type="button"
                key={`${line.start}-${lineIndex}`}
                onClick={() => {
                  handleSeekByLyricLine(lineIndex);
                }}
                ref={(node) => {
                  lineRefs.current[lineIndex] = node;
                }}
                className={lineClassName}
              >
                {lineContent}
              </button>
            );
          }

          return (
            <p key={`${line.start}-${lineIndex}`} className={lineClassName}>
              {lineContent}
            </p>
          );
        })}
      </div>
    </div>
  );
}
