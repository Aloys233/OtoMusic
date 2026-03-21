import { motion } from "framer-motion";
import { useEffect, useMemo, useRef } from "react";

import type {
  LyricsData,
  TimedLyricLine,
  TimedLyricSyllable,
} from "@/lib/api/subsonic-client";
import { cn } from "@/lib/utils";

type AppleMusicLyricsProps = {
  lyrics: LyricsData;
  progress: number;
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

function createFallbackTimedLines(text: string, duration: number): TimedLyricLine[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return [];
  }

  const totalDuration = Math.max(duration, lines.length * 2.2);
  const lineDuration = totalDuration / lines.length;

  return lines.map((line, index) => {
    const start = index * lineDuration;
    const end = start + lineDuration;

    return {
      text: line,
      start,
      end,
      syllables: [],
    };
  });
}

function expandSyllablesToGlyphs(
  syllables: TimedLyricSyllable[],
  lineIndex: number,
): LyricGlyph[] {
  if (syllables.length === 0) {
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

  // 严格时间轴模式：没有字/词级时间，就只按整行时间跳动，不做平均拆分。
  return [
    {
      text: line.text,
      start: line.start,
      end: line.end,
      key: `${lineIndex}-line`,
    },
  ];
}

function resolveActiveLineIndex(lines: TimedLyricLine[], progress: number) {
  if (lines.length === 0) {
    return -1;
  }

  const activeIndex = lines.findIndex((line, index) => {
    const nextStart = lines[index + 1]?.start;
    const end = typeof nextStart === "number" ? nextStart : line.end;
    return progress >= line.start && progress < end;
  });

  if (activeIndex >= 0) {
    return activeIndex;
  }

  if (progress < lines[0].start) {
    return 0;
  }

  return lines.length - 1;
}

export function AppleMusicLyrics({
  lyrics,
  progress,
  duration,
  isPlaying,
  immersive = false,
  className,
}: AppleMusicLyricsProps) {
  const lyricLines = useMemo(() => {
    if (lyrics.timedLines.length > 0) {
      return lyrics.timedLines;
    }

    return createFallbackTimedLines(lyrics.text, duration);
  }, [duration, lyrics.text, lyrics.timedLines]);

  const lineGlyphs = useMemo(
    () => lyricLines.map((line, index) => buildLineGlyphs(line, index)),
    [lyricLines],
  );

  const activeLineIndex = useMemo(
    () => resolveActiveLineIndex(lyricLines, progress),
    [lyricLines, progress],
  );

  const lineRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  useEffect(() => {
    if (activeLineIndex < 0) {
      return;
    }

    const node = lineRefs.current[activeLineIndex];
    node?.scrollIntoView({
      block: "center",
      behavior: isPlaying ? "smooth" : "auto",
    });
  }, [activeLineIndex, isPlaying]);

  return (
    <div
      className={cn(
        immersive
          ? "h-full overflow-y-auto px-4 py-4 sm:px-8 sm:py-6 lg:px-12 lg:py-8"
          : "h-full overflow-y-auto rounded-2xl border border-slate-200/80 bg-white/70 px-5 py-6 dark:border-slate-800/80 dark:bg-slate-950/65",
        className,
      )}
    >
      <div className={cn(immersive ? "space-y-6 py-20 lg:space-y-8 lg:py-28" : "space-y-4 py-20")}>
        {lyricLines.map((line, lineIndex) => {
          const isActiveLine = lineIndex === activeLineIndex;
          const isPastLine = progress >= line.end;
          const glyphs = lineGlyphs[lineIndex] ?? [];

          return (
            <p
              key={`${line.start}-${lineIndex}`}
              ref={(node) => {
                lineRefs.current[lineIndex] = node;
              }}
              className={cn(
                immersive
                  ? "text-[clamp(1.9rem,3.05vw,3rem)] font-semibold leading-[1.24] tracking-tight text-white transition-all duration-300"
                  : "text-[1.45rem] font-semibold leading-[1.45] tracking-tight transition-all duration-300",
                immersive
                  ? isActiveLine
                    ? "scale-[1.04] opacity-100"
                    : "scale-[0.98] opacity-45"
                  : isActiveLine
                    ? "text-slate-900 dark:text-white"
                    : isPastLine
                      ? "text-slate-700/75 dark:text-slate-300/75"
                      : "text-slate-400 dark:text-slate-500",
                !immersive && !isActiveLine && "scale-[0.98]",
              )}
            >
              {glyphs.map((glyph) => {
                const isPastGlyph = progress >= glyph.end;
                const isActiveGlyph = progress >= glyph.start && progress < glyph.end;
                const state = isActiveGlyph && isPlaying ? "active" : "idle";

                return (
                  <motion.span
                    key={glyph.key}
                    variants={{
                      idle: { y: 0, scale: 1 },
                      active: immersive
                        ? { y: [0, -2, 0], scale: [1, 1.04, 1] }
                        : { y: [0, -5, 0], scale: [1, 1.1, 1] },
                    }}
                    animate={state}
                    transition={
                      state === "active"
                        ? {
                            duration: immersive ? 0.22 : 0.34,
                            ease: [0.22, 1, 0.36, 1],
                            times: [0, 0.45, 1],
                          }
                        : {
                            duration: 0.18,
                            ease: "easeOut",
                          }
                    }
                    className={cn(
                      "inline-block whitespace-pre transition-colors duration-200",
                      immersive
                        ? "text-current"
                        : isActiveGlyph || isPastGlyph
                          ? "text-slate-900 dark:text-slate-100"
                          : "text-slate-400 dark:text-slate-500",
                    )}
                  >
                    {glyph.text}
                  </motion.span>
                );
              })}
            </p>
          );
        })}
      </div>
    </div>
  );
}
