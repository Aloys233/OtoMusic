import axios, { type AxiosInstance } from "axios";
import SparkMD5 from "spark-md5";

import type {
  SubsonicAlbum,
  SubsonicGenre,
  SubsonicMusicFolder,
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

type RequestOptions = {
  signal?: AbortSignal;
};

const DEFAULT_API_VERSION = "1.16.1";
const DEFAULT_CLIENT_NAME = "OtoMusic";

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

export type ScanStatus = {
  scanning: boolean;
  count: number;
};

type TimeCandidate = {
  raw: number;
  isClockFormat: boolean;
};

type NormalizableLyricLine = {
  text: string;
  start: number;
  end?: number;
  syllables?: TimedLyricSyllable[];
};

function parseClockTime(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?$/);
  if (!match) return null;

  const minutes = Number.parseInt(match[1], 10);
  const seconds = Number.parseInt(match[2], 10);
  const fraction = match[3] || "0";
  const fractionSeconds = Number.parseInt(fraction, 10) / Math.pow(10, fraction.length);

  return minutes * 60 + seconds + fractionSeconds;
}

function normalizeLyricText(value: unknown) {
  return typeof value === "string" ? value.replace(/\r/g, "").trim() : "";
}

function previewLyricText(value: string, maxLength = 64) {
  return value.slice(0, maxLength).replace(/\n/g, "\\n");
}

function estimateLineDuration(text: string) {
  const charCount = Math.max(1, Array.from(text).length);
  return Math.min(8, Math.max(1.1, charCount * 0.12));
}

function normalizeLyricLines(lines: NormalizableLyricLine[]): TimedLyricLine[] {
  const processed = lines
    .map((l) => ({ ...l, text: normalizeLyricText(l.text) || " ", start: Math.max(0, l.start) }))
    .sort((a, b) => a.start - b.start);

  if (processed.length === 0) return [];

  const merged: NormalizableLyricLine[] = [];
  for (const line of processed) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.start - line.start) < 0.02 && line.text.trim() && last.text.trim()) {
      last.text += `\n${line.text}`;
    } else {
      merged.push({ ...line });
    }
  }

  return merged.map((line, index) => {
    const nextStart = merged[index + 1]?.start;
    const explicitEnd = typeof line.end === "number" && Number.isFinite(line.end) ? line.end : undefined;
    const fallbackEnd = line.start + estimateLineDuration(line.text);
    const nextBound = typeof nextStart === "number" ? Math.max(line.start + 0.1, nextStart - 0.01) : undefined;
    let end = explicitEnd ?? fallbackEnd;
    if (typeof nextBound === "number") {
      end = Math.min(end, nextBound);
    }
    if (!Number.isFinite(end) || end <= line.start) {
      end = line.start + 0.1;
    }

    return { text: line.text, start: line.start, end, syllables: [] };
  });
}

function parseLrc(rawLyrics: string): LyricsData | null {
  if (!rawLyrics || !rawLyrics.trim()) return null;

  const normalizedRawLyrics = rawLyrics.replace(/［/g, "[").replace(/］/g, "]");
  const rows = normalizedRawLyrics.split(/\r?\n/);
  const entries: NormalizableLyricLine[] = [];
  let offsetSeconds = 0;

  for (const row of rows) {
    const match = row.match(/\[offset:([+-]?\d+)\]/i);
    if (match) offsetSeconds = Number.parseInt(match[1], 10) / 1000;
  }

  const tsRegex = /\[(\d+):(\d{2})(?::(\d{2}))?(?:[.:,](\d{1,3}))?\]/g;

  for (const row of rows) {
    const line = row.trim();
    if (!line) continue;
    const matches = Array.from(line.matchAll(tsRegex));
    if (matches.length === 0) {
      const looseMatch = line.match(
        /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:[.:,](\d{1,3}))?\s*(.*)$/,
      );
      if (!looseMatch) continue;

      const p1 = Number.parseInt(looseMatch[1], 10);
      const p2 = Number.parseInt(looseMatch[2], 10);
      const p3 = looseMatch[3] ? Number.parseInt(looseMatch[3], 10) : null;
      const frac = looseMatch[4] || "0";
      const fractionSeconds = Number.parseInt(frac, 10) / Math.pow(10, frac.length);
      const text = looseMatch[5]?.trim() || " ";
      const time = p3 !== null ? p1 * 3600 + p2 * 60 + p3 + fractionSeconds : p1 * 60 + p2 + fractionSeconds;
      entries.push({ text, start: time + offsetSeconds });
      continue;
    }
    const text = line.replace(tsRegex, "").trim();
    
    for (const match of matches) {
      let time = 0;
      const p1 = Number.parseInt(match[1], 10);
      const p2 = Number.parseInt(match[2], 10);
      const p3 = match[3] ? Number.parseInt(match[3], 10) : null;
      const frac = match[4] || "0";
      const fractionSeconds = Number.parseInt(frac, 10) / Math.pow(10, frac.length);
      time = p3 !== null ? p1 * 3600 + p2 * 60 + p3 + fractionSeconds : p1 * 60 + p2 + fractionSeconds;
      entries.push({ text: text || " ", start: time + offsetSeconds });
    }
  }

  if (entries.length === 0) return null;
  const timedLines = normalizeLyricLines(entries);
  return { text: timedLines.map((l) => l.text).join("\n"), timedLines };
}

function parseTimeCandidate(value: unknown): TimeCandidate | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { raw: value, isClockFormat: false };
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const clock = parseClockTime(trimmed);
  if (clock !== null) {
    return { raw: clock, isClockFormat: true };
  }

  const numeric = Number.parseFloat(trimmed);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return { raw: numeric, isClockFormat: false };
}

function inferMilliseconds(candidates: TimeCandidate[]) {
  if (candidates.length === 0) {
    return false;
  }
  if (candidates.some((candidate) => candidate.isClockFormat)) {
    return false;
  }
  const values = candidates.map((candidate) => candidate.raw).filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return false;
  }
  const max = Math.max(...values);
  if (max >= 10_000) {
    return true;
  }
  return max >= 1_000 && values.every((value) => Number.isInteger(value));
}

function resolveTimeSeconds(value: unknown, assumeMilliseconds: boolean) {
  const candidate = parseTimeCandidate(value);
  if (!candidate) {
    return null;
  }
  const seconds = candidate.isClockFormat
    ? candidate.raw
    : assumeMilliseconds
      ? candidate.raw / 1000
      : candidate.raw;
  return Number.isFinite(seconds) ? Math.max(0, seconds) : null;
}

function parseStructuredLyrics(rawStructuredLyrics: unknown): LyricsData | null {
  const blocks = Array.isArray(rawStructuredLyrics)
    ? rawStructuredLyrics
    : rawStructuredLyrics
      ? [rawStructuredLyrics]
      : [];

  for (const block of blocks) {
    if (!block || typeof block !== "object") {
      continue;
    }

    const payload = block as Record<string, unknown>;
    const rawLines = payload.line ?? payload.lines;
    if (!Array.isArray(rawLines) || rawLines.length === 0) {
      continue;
    }

    const startCandidates = rawLines
      .map((line) => {
        if (!line || typeof line !== "object") {
          return null;
        }
        return parseTimeCandidate((line as Record<string, unknown>).start);
      })
      .filter((candidate): candidate is TimeCandidate => Boolean(candidate));
    const assumeMilliseconds = inferMilliseconds(startCandidates);

    const offsetCandidate = parseTimeCandidate(payload.offset);
    const offsetSeconds = offsetCandidate
      ? offsetCandidate.isClockFormat
        ? offsetCandidate.raw
        : Math.abs(offsetCandidate.raw) >= 1_000
          ? offsetCandidate.raw / 1000
          : offsetCandidate.raw
      : 0;

    const entries: NormalizableLyricLine[] = [];

    for (const rawLine of rawLines) {
      if (!rawLine || typeof rawLine !== "object") {
        continue;
      }
      const line = rawLine as Record<string, unknown>;
      const text = normalizeLyricText(line.value ?? line.text);
      const start = resolveTimeSeconds(line.start, assumeMilliseconds);
      if (start === null) {
        continue;
      }

      const duration = resolveTimeSeconds(line.duration, assumeMilliseconds);
      const explicitEnd = resolveTimeSeconds(line.end, assumeMilliseconds);
      const end = explicitEnd ?? (duration !== null ? start + duration : undefined);

      entries.push({
        text: text || " ",
        start: start + offsetSeconds,
        end: typeof end === "number" ? end + offsetSeconds : undefined,
      });
    }

    if (entries.length === 0) {
      continue;
    }

    const timedLines = normalizeLyricLines(entries);
    if (timedLines.length === 0) {
      continue;
    }

    return {
      text: timedLines.map((line) => line.text).join("\n"),
      timedLines,
    };
  }

  return null;
}

type LyricsApiPayload = {
  lyrics?: { value?: string };
  lyricsList?: { lyrics?: Array<{ value?: string }>; structuredLyrics?: unknown[] };
  structuredLyrics?: unknown[];
};

function collectTextLyricsCandidates(payload: LyricsApiPayload): string[] {
  return [payload.lyrics?.value, ...(payload.lyricsList?.lyrics?.map((line) => line.value) ?? [])].filter(
    (value): value is string => typeof value === "string" && normalizeLyricText(value).length > 0,
  );
}

function collectStructuredLyricsCandidates(payload: LyricsApiPayload): unknown[] {
  return [...(payload.lyricsList?.structuredLyrics ?? []), ...(payload.structuredLyrics ?? [])];
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
    this.http = axios.create({ baseURL: this.normalizedBaseUrl, timeout: config.timeoutMs ?? 12_000 });
  }

  async ping(options: RequestOptions = {}) {
    await this.get<{}>("/rest/ping.view", {}, options);
  }

  async getAlbumList2(
    type: AlbumListType = "newest",
    size = 40,
    offset = 0,
    options: RequestOptions = {},
  ) {
    const response = await this.get<{ albumList2?: { album?: SubsonicAlbum[] } }>(
      "/rest/getAlbumList2.view",
      { type, size, offset },
      options,
    );
    return response.albumList2?.album ?? [];
  }

  async getAlbum(id: string, options: RequestOptions = {}) {
    const response = await this.get<{ album?: SubsonicAlbum & { song?: SubsonicSong[] } }>(
      "/rest/getAlbum.view",
      { id },
      options,
    );
    if (!response.album) {
      const error = new Error(`Album not found: ${id}`) as SubsonicError;
      error.code = 404;
      throw error;
    }
    return { ...response.album, song: response.album.song ?? [] };
  }

  async search3(
    query: string,
    songCount = 20,
    albumCount = 20,
    options: RequestOptions = {},
  ) {
    const response = await this.get<{
      searchResult3?: { album?: SubsonicAlbum[]; song?: SubsonicSong[] };
    }>("/rest/search3.view", { query, songCount, albumCount, artistCount: 0 }, options);
    return { albums: response.searchResult3?.album ?? [], songs: response.searchResult3?.song ?? [] };
  }

  async getStarred2(options: RequestOptions = {}) {
    const response = await this.get<{
      starred2?: { album?: SubsonicAlbum[]; song?: SubsonicSong[] };
    }>("/rest/getStarred2.view", {}, options);
    return {
      albums: response.starred2?.album ?? [],
      songs: response.starred2?.song ?? [],
    };
  }

  async getGenres(options: RequestOptions = {}) {
    const response = await this.get<{ genres?: { genre?: SubsonicGenre[] } }>(
      "/rest/getGenres.view",
      {},
      options,
    );
    return response.genres?.genre ?? [];
  }

  async getMusicFolders(options: RequestOptions = {}) {
    const response = await this.get<{ musicFolders?: { musicFolder?: SubsonicMusicFolder[] } }>(
      "/rest/getMusicFolders.view",
      {},
      options,
    );
    return response.musicFolders?.musicFolder ?? [];
  }

  async startScan(options: RequestOptions = {}): Promise<ScanStatus> {
    const response = await this.get<{ scanStatus?: { scanning?: boolean; count?: number } }>(
      "/rest/startScan.view",
      {},
      options,
    );
    return {
      scanning: Boolean(response.scanStatus?.scanning),
      count: response.scanStatus?.count ?? 0,
    };
  }

  async getScanStatus(options: RequestOptions = {}): Promise<ScanStatus> {
    const response = await this.get<{ scanStatus?: { scanning?: boolean; count?: number } }>(
      "/rest/getScanStatus.view",
      {},
      options,
    );
    return {
      scanning: Boolean(response.scanStatus?.scanning),
      count: response.scanStatus?.count ?? 0,
    };
  }

  async getLyrics(
    artist: string,
    title: string,
    songId?: string,
    options: RequestOptions = {},
  ): Promise<LyricsData> {
    console.log(`[Lyrics] 正在获取歌词: ${artist} - ${title}${songId ? ` (songId=${songId})` : ""}`);
    const fallbackTexts: string[] = [];

    const tryParsePayload = (payload: LyricsApiPayload, source: string): LyricsData | null => {
      const structuredCandidates = collectStructuredLyricsCandidates(payload);
      const textCandidates = collectTextLyricsCandidates(payload);
      console.log(
        `[Lyrics] ${source}: 结构化源 ${structuredCandidates.length} 个，文本源 ${textCandidates.length} 个`,
      );

      for (let i = 0; i < structuredCandidates.length; i++) {
        const parsed = parseStructuredLyrics(structuredCandidates[i]);
        if (parsed && parsed.timedLines.length > 0) {
          console.log(`[Lyrics] ${source}: 结构化歌词解析成功，提取到 ${parsed.timedLines.length} 行`);
          return parsed;
        }
      }

      for (let i = 0; i < textCandidates.length; i++) {
        const raw = textCandidates[i]!;
        console.log(`[Lyrics] ${source}: 正在解析文本源 ${i + 1}: ${previewLyricText(raw)}...`);
        const parsed = parseLrc(raw);
        if (parsed && parsed.timedLines.length > 0) {
          console.log(`[Lyrics] ${source}: 文本歌词解析成功，提取到 ${parsed.timedLines.length} 行`);
          return parsed;
        }
      }

      if (textCandidates[0]) {
        fallbackTexts.push(textCandidates[0]);
      }
      return null;
    };

    if (songId) {
      try {
        const bySongResponse = await this.get<LyricsApiPayload>(
          "/rest/getLyricsBySongId.view",
          { id: songId },
          options,
        );
        const parsed = tryParsePayload(bySongResponse, "getLyricsBySongId.view");
        if (parsed) {
          return parsed;
        }
      } catch (error) {
        console.warn(
          `[Lyrics] getLyricsBySongId.view 调用失败，回退到 getLyrics.view: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const byMetaResponse = await this.get<LyricsApiPayload>(
      "/rest/getLyrics.view",
      { artist, title },
      options,
    );
    const parsed = tryParsePayload(byMetaResponse, "getLyrics.view");
    if (parsed) {
      return parsed;
    }

    console.warn("[Lyrics] 未解析到时间轴，回退为纯文本歌词");
    const plainText = fallbackTexts[0] ?? "";
    return { text: plainText.replace(/\[.*?\]/g, "").trim(), timedLines: [] };
  }

  getCoverArtUrl(id: string, size = 512) {
    const url = new URL(`${this.normalizedBaseUrl}/rest/getCoverArt.view`);
    this.appendAuthSearchParams(url.searchParams);
    url.searchParams.set("id", id); url.searchParams.set("size", String(size));
    return url.toString();
  }

  getStreamUrl(id: string, maxBitrate = 0) {
    const url = new URL(`${this.normalizedBaseUrl}/rest/stream.view`);
    this.appendAuthSearchParams(url.searchParams);
    url.searchParams.set("id", id); url.searchParams.set("maxBitrate", String(maxBitrate));
    return url.toString();
  }

  private async get<T extends Record<string, unknown>>(
    path: string,
    params: Record<string, unknown> = {},
    options: RequestOptions = {},
  ) {
    const response = await this.http.get<SubsonicResponseEnvelope<T>>(path, {
      params: { ...this.authParams, ...params },
      signal: options.signal,
    });
    const payload = response.data["subsonic-response"] as SubsonicResponsePayload<T>;
    if (payload.status === "failed") throw new Error(payload.error?.message || "Subsonic request failed");
    return payload;
  }

  private createAuthParams(): AuthParams {
    const salt = this.createSalt(12);
    const token = SparkMD5.hash(`${this.password}${salt}`);
    return { u: this.username, t: token, s: salt, v: this.apiVersion, c: this.clientName, f: "json" };
  }

  private appendAuthSearchParams(searchParams: URLSearchParams) {
    const auth = this.authParams;
    searchParams.set("u", auth.u); searchParams.set("t", auth.t); searchParams.set("s", auth.s);
    searchParams.set("v", auth.v); searchParams.set("c", auth.c); searchParams.set("f", auth.f);
  }

  private createSalt(length: number) {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    const randomValues = new Uint8Array(length);
    crypto.getRandomValues(randomValues);
    return Array.from(randomValues, (value) => alphabet[value % alphabet.length]).join("");
  }
}
