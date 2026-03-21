import axios, { type AxiosInstance } from "axios";
import SparkMD5 from "spark-md5";

import type {
  SubsonicAlbum,
  SubsonicResponseEnvelope,
  SubsonicSong,
} from "@/types/subsonic";

export type AlbumListType =
  | "random"
  | "newest"
  | "frequent"
  | "recent"
  | "alphabeticalByName"
  | "alphabeticalByArtist"
  | "starred"
  | "byYear"
  | "byGenre";

export type SubsonicClientConfig = {
  baseUrl: string;
  username: string;
  password: string;
  clientName?: string;
  apiVersion?: string;
  timeoutMs?: number;
};

type SubsonicError = Error & {
  code?: number;
};

type SubsonicResponsePayload<T> = {
  status: "ok" | "failed";
  version: string;
  type: string;
  serverVersion?: string;
  openSubsonic?: boolean;
  error?: {
    code: number;
    message: string;
  };
} & T;

type AuthParams = {
  u: string;
  t: string;
  s: string;
  v: string;
  c: string;
  f: "json";
};

const DEFAULT_API_VERSION = "1.16.1";
const DEFAULT_CLIENT_NAME = "OtoMusic";
const LRC_METADATA_REGEX = /^\[(ti|ar|al|by|offset|re):/i;

export type TimedLyricSyllable = {
  text: string;
  start: number;
  end: number;
};

export type TimedLyricLine = {
  text: string;
  start: number;
  end: number;
  syllables: TimedLyricSyllable[];
};

export type LyricsData = {
  text: string;
  timedLines: TimedLyricLine[];
};

type TimeCandidate = {
  raw: number;
  isClockFormat: boolean;
};

type RawStructuredLyricLine = {
  text: string;
  start: TimeCandidate | null;
  end: TimeCandidate | null;
  duration: TimeCandidate | null;
  syllables: Array<{
    text: string;
    start: TimeCandidate | null;
    end: TimeCandidate | null;
    duration: TimeCandidate | null;
  }>;
};

type NormalizableLyricLine = {
  text: string;
  start: number;
  end?: number;
  syllables?: TimedLyricSyllable[];
};

function parseFractionalSeconds(fraction?: string) {
  if (!fraction) {
    return 0;
  }

  if (!/^\d+$/.test(fraction)) {
    return 0;
  }

  if (fraction.length === 3) {
    return Number.parseInt(fraction, 10) / 1000;
  }

  if (fraction.length === 2) {
    return Number.parseInt(fraction, 10) / 100;
  }

  return Number.parseInt(fraction, 10) / 10;
}

function parseClockTime(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?$/);
  if (!match) {
    return null;
  }

  const minutes = Number.parseInt(match[1], 10);
  const seconds = Number.parseInt(match[2], 10);

  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }

  return minutes * 60 + seconds + parseFractionalSeconds(match[3]);
}

function parseTimeCandidate(value: unknown): TimeCandidate | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    return {
      raw: value,
      isClockFormat: false,
    };
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const clock = parseClockTime(normalized);
  if (clock !== null) {
    return {
      raw: clock,
      isClockFormat: true,
    };
  }

  const numeric = Number.parseFloat(normalized);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return {
    raw: numeric,
    isClockFormat: false,
  };
}

function toSeconds(candidate: TimeCandidate | null, divisor: number) {
  if (!candidate) {
    return null;
  }

  if (candidate.isClockFormat) {
    return Math.max(0, candidate.raw);
  }

  return Math.max(0, candidate.raw / divisor);
}

function inferTimeDivisor(candidates: TimeCandidate[]) {
  const numericValues = candidates
    .filter((item) => !item.isClockFormat)
    .map((item) => item.raw)
    .filter((item) => Number.isFinite(item));

  if (numericValues.length === 0) {
    return 1;
  }

  const hasFractional = numericValues.some((value) => !Number.isInteger(value));
  if (hasFractional) {
    return 1;
  }

  const sorted = [...numericValues].sort((a, b) => a - b);
  const positiveDiffs: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const diff = sorted[index] - sorted[index - 1];
    if (diff > 0) {
      positiveDiffs.push(diff);
    }
  }

  const maxValue = sorted[sorted.length - 1] ?? 0;
  const medianDiff =
    positiveDiffs.length > 0
      ? positiveDiffs[Math.floor(positiveDiffs.length / 2)] ?? 0
      : 0;

  // 毫秒时间轴通常是 5 位数以上，且相邻时间差常见在百级以上。
  if (maxValue >= 10_000 || medianDiff >= 100) {
    return 1000;
  }

  return 1;
}

function normalizeLyricText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\r/g, "").trim();
}

function estimateLineDuration(text: string) {
  const charCount = Math.max(1, Array.from(text).length);
  return Math.min(8, Math.max(1.1, charCount * 0.12));
}

function normalizeLyricLines(lines: NormalizableLyricLine[]): TimedLyricLine[] {
  const sorted = lines
    .map((line) => ({
      ...line,
      text: normalizeLyricText(line.text),
      start: Math.max(0, line.start),
    }))
    .filter((line) => line.text.length > 0)
    .sort((a, b) => a.start - b.start);

  return sorted.map((line, index) => {
    const nextStart = sorted[index + 1]?.start;
    const fallbackEnd = line.start + estimateLineDuration(line.text);
    const derivedEnd = typeof nextStart === "number" ? nextStart - 0.04 : fallbackEnd;
    const end = Math.max(line.start + 0.24, line.end ?? derivedEnd);

    const normalizedSyllables = (line.syllables ?? [])
      .map((syllable) => ({
        ...syllable,
        text: normalizeLyricText(syllable.text),
        start: Math.max(line.start, syllable.start),
      }))
      .filter((syllable) => syllable.text.length > 0)
      .sort((a, b) => a.start - b.start)
      .map((syllable, syllableIndex, list) => {
        const nextSyllableStart = list[syllableIndex + 1]?.start ?? end;
        const boundedEnd = Math.min(
          end,
          Math.max(
            syllable.start + 0.05,
            Math.min(syllable.end, nextSyllableStart),
          ),
        );

        return {
          text: syllable.text,
          start: syllable.start,
          end: boundedEnd,
        };
      })
      .filter((syllable) => syllable.end > syllable.start);

    return {
      text: line.text,
      start: line.start,
      end,
      syllables: normalizedSyllables,
    };
  });
}

function parseStructuredLyrics(
  structuredLyrics:
    | Array<{
        line?: Array<Record<string, unknown>>;
      }>
    | undefined,
): TimedLyricLine[] {
  if (!structuredLyrics?.length) {
    return [];
  }

  const parseStructuredLine = (line: Record<string, unknown>): RawStructuredLyricLine => {
    const text = normalizeLyricText(line.value) || normalizeLyricText(line.text);
    const start = parseTimeCandidate(line.start ?? line.startTime ?? line.time ?? line.offset);
    const end = parseTimeCandidate(line.end ?? line.endTime);
    const duration = parseTimeCandidate(line.duration ?? line.length);

    const syllableCandidates = ["syllable", "syllables", "word", "words", "segment", "segments"];
    const syllables: RawStructuredLyricLine["syllables"] = [];

    for (const key of syllableCandidates) {
      const value = line[key];
      if (!Array.isArray(value)) {
        continue;
      }

      for (const rawPart of value) {
        if (!rawPart || typeof rawPart !== "object") {
          continue;
        }

        const part = rawPart as Record<string, unknown>;
        const partText =
          normalizeLyricText(part.value) ||
          normalizeLyricText(part.text) ||
          normalizeLyricText(part.word) ||
          normalizeLyricText(part.syllable);

        if (!partText) {
          continue;
        }

        syllables.push({
          text: partText,
          start: parseTimeCandidate(part.start ?? part.startTime ?? part.time ?? part.offset),
          end: parseTimeCandidate(part.end ?? part.endTime),
          duration: parseTimeCandidate(part.duration ?? part.length),
        });
      }

      if (syllables.length > 0) {
        break;
      }
    }

    return {
      text,
      start,
      end,
      duration,
      syllables,
    };
  };

  const parseStructuredBlock = (
    block: {
      line?: Array<Record<string, unknown>>;
    },
  ): TimedLyricLine[] => {
    const rawLines = (block.line ?? [])
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map(parseStructuredLine)
      .filter((item) => item.text.length > 0);

    if (rawLines.length === 0) {
      return [];
    }

    const hasRealTiming = rawLines.some((line) =>
      Boolean(line.start || line.end || line.duration) ||
      line.syllables.some((syllable) => Boolean(syllable.start || syllable.end || syllable.duration)),
    );

    if (!hasRealTiming) {
      return [];
    }

    const timeCandidates: TimeCandidate[] = [];
    for (const line of rawLines) {
      if (line.start) {
        timeCandidates.push(line.start);
      }
      if (line.end) {
        timeCandidates.push(line.end);
      }
      if (line.duration) {
        timeCandidates.push(line.duration);
      }

      for (const syllable of line.syllables) {
        if (syllable.start) {
          timeCandidates.push(syllable.start);
        }
        if (syllable.end) {
          timeCandidates.push(syllable.end);
        }
        if (syllable.duration) {
          timeCandidates.push(syllable.duration);
        }
      }
    }

    const divisor = inferTimeDivisor(timeCandidates);
    let fallbackLineStart = 0;

    const normalizable = rawLines.map((line) => {
      const lineStart = toSeconds(line.start, divisor) ?? fallbackLineStart;
      const lineDuration = toSeconds(line.duration, divisor);
      const explicitLineEnd = toSeconds(line.end, divisor);
      const lineEnd = explicitLineEnd ?? (lineDuration ? lineStart + lineDuration : undefined);

      let fallbackSyllableStart = lineStart;
      const syllables = line.syllables.map((syllable) => {
        const syllableStart = toSeconds(syllable.start, divisor) ?? fallbackSyllableStart;
        const syllableDuration = toSeconds(syllable.duration, divisor);
        const explicitSyllableEnd = toSeconds(syllable.end, divisor);
        const syllableEnd =
          explicitSyllableEnd ??
          (syllableDuration ? syllableStart + syllableDuration : syllableStart + 0.08);

        fallbackSyllableStart = syllableEnd;
        return {
          text: syllable.text,
          start: syllableStart,
          end: syllableEnd,
        };
      });

      fallbackLineStart = lineEnd ?? (lineStart + estimateLineDuration(line.text));
      return {
        text: line.text,
        start: lineStart,
        end: lineEnd,
        syllables,
      };
    });

    return normalizeLyricLines(normalizable);
  };

  let bestTimedLines: TimedLyricLine[] = [];
  let bestScore = -1;

  for (const block of structuredLyrics) {
    const parsed = parseStructuredBlock(block);
    if (parsed.length === 0) {
      continue;
    }

    const score = parsed.reduce(
      (sum, line) => sum + (line.syllables.length > 0 ? 10 + line.syllables.length : 1),
      0,
    );

    if (score > bestScore) {
      bestTimedLines = parsed;
      bestScore = score;
    }
  }

  return bestTimedLines;
}

function parseLrcTimestamp(minutes: string, seconds: string, fraction?: string) {
  const mm = Number.parseInt(minutes, 10);
  const ss = Number.parseInt(seconds, 10);
  if (!Number.isFinite(mm) || !Number.isFinite(ss)) {
    return null;
  }

  return mm * 60 + ss + parseFractionalSeconds(fraction);
}

function parseInlineTimedSyllables(lineContent: string, baseOffset: number): TimedLyricSyllable[] {
  const inlineTimestampRegex = /<(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?>/g;
  const inlineMatches = Array.from(lineContent.matchAll(inlineTimestampRegex));
  if (inlineMatches.length === 0) {
    return [];
  }

  const parsed: TimedLyricSyllable[] = [];

  inlineMatches.forEach((match, index) => {
    const start = parseLrcTimestamp(match[1], match[2], match[3]);
    if (start === null) {
      return;
    }

    const contentStart = (match.index ?? 0) + match[0].length;
    const contentEnd = inlineMatches[index + 1]?.index ?? lineContent.length;
    const text = normalizeLyricText(lineContent.slice(contentStart, contentEnd));
    if (!text) {
      return;
    }

    const nextStartMatch = inlineMatches[index + 1];
    const nextStart = nextStartMatch
      ? parseLrcTimestamp(nextStartMatch[1], nextStartMatch[2], nextStartMatch[3])
      : null;
    const fallbackEnd = start + Math.max(0.08, Math.min(0.6, Array.from(text).length * 0.1));

    parsed.push({
      text,
      start: start + baseOffset,
      end: (nextStart ?? fallbackEnd) + baseOffset,
    });
  });

  return parsed;
}

function parseLrcLyrics(rawLyrics: string): LyricsData | null {
  const rows = rawLyrics.split(/\r?\n/);
  const entries: NormalizableLyricLine[] = [];
  let offsetSeconds = 0;

  for (const row of rows) {
    const offsetMatch = row.trim().match(/^\[offset:([+-]?\d+)\]$/i);
    if (!offsetMatch) {
      continue;
    }

    const offsetMs = Number.parseInt(offsetMatch[1], 10);
    if (Number.isFinite(offsetMs)) {
      offsetSeconds = offsetMs / 1000;
    }
  }

  for (const row of rows) {
    const normalizedRow = row.trim();
    if (!normalizedRow || LRC_METADATA_REGEX.test(normalizedRow)) {
      continue;
    }

    const lineTimestampRegex = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
    const timestampMatches = Array.from(normalizedRow.matchAll(lineTimestampRegex));
    if (timestampMatches.length === 0) {
      continue;
    }

    const lineContent = normalizeLyricText(
      normalizedRow.replace(lineTimestampRegex, "").replace(/\s+/g, " "),
    );

    if (!lineContent) {
      continue;
    }

    const lineTimestamps = timestampMatches
      .map((match) => parseLrcTimestamp(match[1], match[2], match[3]))
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b);

    if (lineTimestamps.length === 0) {
      continue;
    }

    const cleanText = normalizeLyricText(
      lineContent.replace(/<(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?>/g, ""),
    );
    const firstTimestamp = lineTimestamps[0] ?? 0;
    const templateSyllables = parseInlineTimedSyllables(lineContent, 0);

    for (const timestamp of lineTimestamps) {
      const offset = timestamp - firstTimestamp;
      entries.push({
        text: cleanText,
        start: timestamp + offsetSeconds,
        syllables: templateSyllables.map((syllable) => ({
          text: syllable.text,
          start: syllable.start + offset + offsetSeconds,
          end: syllable.end + offset + offsetSeconds,
        })),
      });
    }
  }

  if (entries.length === 0) {
    return null;
  }

  const timedLines = normalizeLyricLines(entries);
  if (timedLines.length === 0) {
    return null;
  }

  return {
    text: timedLines.map((line) => line.text).join("\n"),
    timedLines,
  };
}

export class SubsonicClient {
  private readonly http: AxiosInstance;

  private readonly normalizedBaseUrl: string;

  private readonly username: string;

  private readonly password: string;

  private readonly apiVersion: string;

  private readonly clientName: string;

  private readonly authParams: AuthParams;

  private readonly coverArtUrlCache = new Map<string, string>();

  private readonly streamUrlCache = new Map<string, string>();

  constructor(config: SubsonicClientConfig) {
    this.normalizedBaseUrl = config.baseUrl.replace(/\/+$/, "");
    this.username = config.username;
    this.password = config.password;
    this.apiVersion = config.apiVersion ?? DEFAULT_API_VERSION;
    this.clientName = config.clientName ?? DEFAULT_CLIENT_NAME;
    this.authParams = this.createAuthParams();

    this.http = axios.create({
      baseURL: this.normalizedBaseUrl,
      timeout: config.timeoutMs ?? 12_000,
    });
  }

  async ping() {
    await this.get<{}>("/rest/ping.view");
  }

  async getAlbumList2(type: AlbumListType = "newest", size = 40, offset = 0) {
    const response = await this.get<{ albumList2?: { album?: SubsonicAlbum[] } }>(
      "/rest/getAlbumList2.view",
      {
        type,
        size,
        offset,
      },
    );

    return response.albumList2?.album ?? [];
  }

  async getAlbum(id: string) {
    const response = await this.get<{ album?: SubsonicAlbum & { song?: SubsonicSong[] } }>(
      "/rest/getAlbum.view",
      { id },
    );

    if (!response.album) {
      const error = new Error(`Album not found: ${id}`) as SubsonicError;
      error.code = 404;
      throw error;
    }

    return {
      ...response.album,
      song: response.album.song ?? [],
    };
  }

  async search3(query: string, songCount = 20, albumCount = 20) {
    const response = await this.get<{
      searchResult3?: {
        album?: SubsonicAlbum[];
        song?: SubsonicSong[];
      };
    }>("/rest/search3.view", {
      query,
      songCount,
      albumCount,
      artistCount: 0,
    });

    return {
      albums: response.searchResult3?.album ?? [],
      songs: response.searchResult3?.song ?? [],
    };
  }

  async getLyrics(artist: string, title: string): Promise<LyricsData> {
    const response = await this.get<{
      lyrics?: {
        artist?: string;
        title?: string;
        value?: string;
      };
      lyricsList?: {
        structuredLyrics?: Array<{
          line?: Array<Record<string, unknown>>;
        }>;
        lyrics?: Array<{
          value?: string;
        }>;
      };
    }>("/rest/getLyrics.view", {
      artist,
      title,
    });

    const structuredTimedLines = parseStructuredLyrics(response.lyricsList?.structuredLyrics);
    if (structuredTimedLines.length > 0) {
      return {
        text: structuredTimedLines.map((line) => line.text).join("\n"),
        timedLines: structuredTimedLines,
      };
    }

    const simpleLyrics = response.lyrics?.value?.trim();
    if (simpleLyrics) {
      const lrcParsed = parseLrcLyrics(simpleLyrics);
      if (lrcParsed) {
        return lrcParsed;
      }

      return {
        text: simpleLyrics,
        timedLines: [],
      };
    }

    const listLyrics = response.lyricsList?.lyrics?.find((item) => item.value?.trim())?.value;
    if (listLyrics) {
      const normalized = listLyrics.trim();
      const lrcParsed = parseLrcLyrics(normalized);
      if (lrcParsed) {
        return lrcParsed;
      }

      return {
        text: normalized,
        timedLines: [],
      };
    }

    const structuredText = response.lyricsList?.structuredLyrics?.[0]?.line
      ?.map((item) => normalizeLyricText(item.value ?? item.text))
      .filter((value): value is string => value.length > 0)
      .join("\n") ?? "";

    return {
      text: structuredText,
      timedLines: [],
    };
  }

  getCoverArtUrl(id: string, size = 512) {
    const cacheKey = `${id}|${size}`;
    const cached = this.coverArtUrlCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const url = new URL(`${this.normalizedBaseUrl}/rest/getCoverArt.view`);
    this.appendAuthSearchParams(url.searchParams);
    url.searchParams.set("id", id);
    url.searchParams.set("size", String(size));
    const resolved = url.toString();
    this.coverArtUrlCache.set(cacheKey, resolved);
    return resolved;
  }

  getStreamUrl(id: string, maxBitrate = 0) {
    const cacheKey = `${id}|${maxBitrate}`;
    const cached = this.streamUrlCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const url = new URL(`${this.normalizedBaseUrl}/rest/stream.view`);
    this.appendAuthSearchParams(url.searchParams);
    url.searchParams.set("id", id);
    // 开发文档要求 FLAC 零转码：显式 maxBitrate=0
    url.searchParams.set("maxBitrate", String(maxBitrate));
    const resolved = url.toString();
    this.streamUrlCache.set(cacheKey, resolved);
    return resolved;
  }

  private async get<T extends Record<string, unknown>>(
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
  ) {
    const response = await this.http.get<SubsonicResponseEnvelope<T>>(path, {
      params: {
        ...this.authParams,
        ...params,
      },
    });

    const payload = response.data["subsonic-response"] as SubsonicResponsePayload<T>;

    if (payload.status === "failed") {
      const message = payload.error?.message ?? "Subsonic request failed";
      const error = new Error(message) as SubsonicError;
      error.code = payload.error?.code;
      throw error;
    }

    return payload;
  }

  private createAuthParams(): AuthParams {
    const salt = this.createSalt(12);
    const token = SparkMD5.hash(`${this.password}${salt}`);

    return {
      u: this.username,
      t: token,
      s: salt,
      v: this.apiVersion,
      c: this.clientName,
      f: "json",
    };
  }

  private appendAuthSearchParams(searchParams: URLSearchParams) {
    const auth = this.authParams;
    searchParams.set("u", auth.u);
    searchParams.set("t", auth.t);
    searchParams.set("s", auth.s);
    searchParams.set("v", auth.v);
    searchParams.set("c", auth.c);
    searchParams.set("f", auth.f);
  }

  private createSalt(length: number) {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    const randomValues = new Uint8Array(length);
    crypto.getRandomValues(randomValues);

    return Array.from(randomValues, (value) => alphabet[value % alphabet.length]).join("");
  }
}
