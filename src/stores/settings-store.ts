import { create } from "zustand";
import { persist } from "zustand/middleware";

export type StreamQuality = "original" | "320" | "128";
export type AccentSource = "manual" | "album";
export type LyricsAlign = "left" | "center";
export type EqualizerPreset = "flat" | "pop" | "classical" | "rock" | "vocal";
export type ReplayGainMode = "off" | "track" | "album";
export type ScrobbleProvider = "none" | "lastfm" | "listenbrainz";

export const EQ_BAND_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
const EQ_MIN_DB = -12;
const EQ_MAX_DB = 12;

export const EQ_PRESETS: Record<EqualizerPreset, number[]> = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  pop: [-1, 2, 4, 5, 3, 0, -1, -1, 1, 2],
  classical: [3, 2, 1, 0, -1, -1, 0, 1, 2, 3],
  rock: [5, 3, 2, -1, -2, -1, 1, 3, 4, 5],
  vocal: [-2, -1, 1, 3, 4, 4, 2, 1, -1, -2],
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeEqBands(input: number[] | undefined) {
  const fallback = EQ_PRESETS.flat;
  if (!Array.isArray(input) || input.length !== EQ_BAND_FREQUENCIES.length) {
    return [...fallback];
  }

  return input.map((value) =>
    Number.isFinite(value) ? clamp(Number(value), EQ_MIN_DB, EQ_MAX_DB) : 0);
}

function normalizeHexColor(input: string) {
  const trimmed = input.trim().toLowerCase();
  const withPrefix = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  const short = withPrefix.match(/^#([0-9a-f]{3})$/i);
  if (short) {
    const [a, b, c] = short[1].split("");
    return `#${a}${a}${b}${b}${c}${c}`;
  }

  if (/^#[0-9a-f]{6}$/i.test(withPrefix)) {
    return withPrefix;
  }

  return "#10b981";
}

function normalizeShortcutAccelerator(input: string) {
  if (input.length === 0) {
    return "";
  }

  if (/^\s+$/.test(input)) {
    return "Space";
  }

  const trimmed = input.trim();
  if (/^space(bar)?$/i.test(trimmed)) {
    return "Space";
  }

  return trimmed;
}

export function resolveMaxBitrateKbps(quality: StreamQuality) {
  if (quality === "320") {
    return 320;
  }
  if (quality === "128") {
    return 128;
  }
  return 0;
}

type SettingsState = {
  outputDeviceId: string;
  preampGainDb: number;
  gaplessPlaybackEnabled: boolean;
  crossfadeEnabled: boolean;
  crossfadeDurationSec: number;
  equalizerEnabled: boolean;
  equalizerBands: number[];
  equalizerPreset: EqualizerPreset;
  streamQuality: StreamQuality;
  accentColor: string;
  accentSource: AccentSource;
  lyricsFontScale: number;
  lyricsAlign: LyricsAlign;
  showTranslatedLyrics: boolean;
  showRomanizedLyrics: boolean;
  nowPlayingBackgroundBlurEnabled: boolean;
  maxCacheGb: number;
  globalShortcutsEnabled: boolean;
  playPauseShortcut: string;
  nextTrackShortcut: string;
  previousTrackShortcut: string;
  scrobbleProvider: ScrobbleProvider;
  lastFmApiKey: string;
  lastFmApiSecret: string;
  lastFmSessionKey: string;
  listenBrainzToken: string;
  desktopLyricsEnabled: boolean;
  replayGainMode: ReplayGainMode;
  playbackSpeed: number;
  fadeDurationSec: number;
  setOutputDeviceId: (deviceId: string) => void;
  setPreampGainDb: (gain: number) => void;
  setGaplessPlaybackEnabled: (enabled: boolean) => void;
  setCrossfadeEnabled: (enabled: boolean) => void;
  setCrossfadeDurationSec: (seconds: number) => void;
  setEqualizerEnabled: (enabled: boolean) => void;
  setEqualizerBand: (index: number, gainDb: number) => void;
  setEqualizerPreset: (preset: EqualizerPreset) => void;
  resetEqualizer: () => void;
  setStreamQuality: (quality: StreamQuality) => void;
  setAccentColor: (color: string) => void;
  setAccentSource: (source: AccentSource) => void;
  setLyricsFontScale: (value: number) => void;
  setLyricsAlign: (align: LyricsAlign) => void;
  setShowTranslatedLyrics: (enabled: boolean) => void;
  setShowRomanizedLyrics: (enabled: boolean) => void;
  setNowPlayingBackgroundBlurEnabled: (enabled: boolean) => void;
  setMaxCacheGb: (value: number) => void;
  setGlobalShortcutsEnabled: (enabled: boolean) => void;
  setPlayPauseShortcut: (accelerator: string) => void;
  setNextTrackShortcut: (accelerator: string) => void;
  setPreviousTrackShortcut: (accelerator: string) => void;
  setScrobbleProvider: (provider: ScrobbleProvider) => void;
  setLastFmApiKey: (value: string) => void;
  setLastFmApiSecret: (value: string) => void;
  setLastFmSessionKey: (value: string) => void;
  setListenBrainzToken: (value: string) => void;
  setDesktopLyricsEnabled: (enabled: boolean) => void;
  setReplayGainMode: (mode: ReplayGainMode) => void;
  setPlaybackSpeed: (speed: number) => void;
  setFadeDurationSec: (duration: number) => void;
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      outputDeviceId: "default",
      preampGainDb: 0,
      gaplessPlaybackEnabled: true,
      crossfadeEnabled: false,
      crossfadeDurationSec: 3,
      equalizerEnabled: false,
      equalizerBands: [...EQ_PRESETS.flat],
      equalizerPreset: "flat",
      streamQuality: "original",
      accentColor: "#10b981",
      accentSource: "manual",
      lyricsFontScale: 1,
      lyricsAlign: "center",
      showTranslatedLyrics: true,
      showRomanizedLyrics: true,
      nowPlayingBackgroundBlurEnabled: true,
      maxCacheGb: 1,
      globalShortcutsEnabled: true,
      playPauseShortcut: "MediaPlayPause",
      nextTrackShortcut: "MediaNextTrack",
      previousTrackShortcut: "MediaPreviousTrack",
      scrobbleProvider: "none",
      lastFmApiKey: "",
      lastFmApiSecret: "",
      lastFmSessionKey: "",
      listenBrainzToken: "",
      desktopLyricsEnabled: false,
      replayGainMode: "off",
      playbackSpeed: 1.0,
      fadeDurationSec: 0.2,
      setOutputDeviceId: (outputDeviceId) => set({ outputDeviceId }),
      setPreampGainDb: (preampGainDb) =>
        set({ preampGainDb: clamp(preampGainDb, -12, 12) }),
      setGaplessPlaybackEnabled: (gaplessPlaybackEnabled) => set({ gaplessPlaybackEnabled }),
      setCrossfadeEnabled: (crossfadeEnabled) => set({ crossfadeEnabled }),
      setCrossfadeDurationSec: (crossfadeDurationSec) =>
        set({ crossfadeDurationSec: clamp(crossfadeDurationSec, 1, 10) }),
      setEqualizerEnabled: (equalizerEnabled) => set({ equalizerEnabled }),
      setEqualizerBand: (index, gainDb) =>
        set((state) => {
          if (index < 0 || index >= EQ_BAND_FREQUENCIES.length) {
            return state;
          }

          const nextBands = [...state.equalizerBands];
          nextBands[index] = clamp(gainDb, EQ_MIN_DB, EQ_MAX_DB);
          return { equalizerBands: nextBands, equalizerPreset: "flat" };
        }),
      setEqualizerPreset: (equalizerPreset) =>
        set({
          equalizerPreset,
          equalizerBands: [...(EQ_PRESETS[equalizerPreset] ?? EQ_PRESETS.flat)],
        }),
      resetEqualizer: () =>
        set({
          equalizerPreset: "flat",
          equalizerBands: [...EQ_PRESETS.flat],
        }),
      setStreamQuality: (streamQuality) => set({ streamQuality }),
      setAccentColor: (accentColor) => set({ accentColor: normalizeHexColor(accentColor) }),
      setAccentSource: (accentSource) => set({ accentSource }),
      setLyricsFontScale: (lyricsFontScale) => set({ lyricsFontScale: clamp(lyricsFontScale, 0.8, 1.6) }),
      setLyricsAlign: (lyricsAlign) => set({ lyricsAlign }),
      setShowTranslatedLyrics: (showTranslatedLyrics) => set({ showTranslatedLyrics }),
      setShowRomanizedLyrics: (showRomanizedLyrics) => set({ showRomanizedLyrics }),
      setNowPlayingBackgroundBlurEnabled: (nowPlayingBackgroundBlurEnabled) =>
        set({ nowPlayingBackgroundBlurEnabled }),
      setMaxCacheGb: (maxCacheGb) => set({ maxCacheGb: clamp(maxCacheGb, 0.5, 10) }),
      setGlobalShortcutsEnabled: (globalShortcutsEnabled) => set({ globalShortcutsEnabled }),
      setPlayPauseShortcut: (playPauseShortcut) =>
        set({ playPauseShortcut: normalizeShortcutAccelerator(playPauseShortcut) }),
      setNextTrackShortcut: (nextTrackShortcut) =>
        set({ nextTrackShortcut: normalizeShortcutAccelerator(nextTrackShortcut) }),
      setPreviousTrackShortcut: (previousTrackShortcut) =>
        set({ previousTrackShortcut: normalizeShortcutAccelerator(previousTrackShortcut) }),
      setScrobbleProvider: (scrobbleProvider) => set({ scrobbleProvider }),
      setLastFmApiKey: (lastFmApiKey) => set({ lastFmApiKey: lastFmApiKey.trim() }),
      setLastFmApiSecret: (lastFmApiSecret) => set({ lastFmApiSecret: lastFmApiSecret.trim() }),
      setLastFmSessionKey: (lastFmSessionKey) => set({ lastFmSessionKey: lastFmSessionKey.trim() }),
      setListenBrainzToken: (listenBrainzToken) => set({ listenBrainzToken: listenBrainzToken.trim() }),
      setDesktopLyricsEnabled: (desktopLyricsEnabled) => set({ desktopLyricsEnabled }),
      setReplayGainMode: (replayGainMode) => set({ replayGainMode }),
      setPlaybackSpeed: (playbackSpeed) => set({ playbackSpeed: clamp(playbackSpeed, 0.5, 2.0) }),
      setFadeDurationSec: (fadeDurationSec) => set({ fadeDurationSec: clamp(fadeDurationSec, 0.05, 0.5) }),
    }),
    {
      name: "otomusic-settings",
      partialize: (state) => ({
        outputDeviceId: state.outputDeviceId,
        preampGainDb: state.preampGainDb,
        gaplessPlaybackEnabled: state.gaplessPlaybackEnabled,
        crossfadeEnabled: state.crossfadeEnabled,
        crossfadeDurationSec: state.crossfadeDurationSec,
        equalizerEnabled: state.equalizerEnabled,
        equalizerBands: normalizeEqBands(state.equalizerBands),
        equalizerPreset: state.equalizerPreset,
        streamQuality: state.streamQuality,
        accentColor: normalizeHexColor(state.accentColor),
        accentSource: state.accentSource,
        lyricsFontScale: state.lyricsFontScale,
        lyricsAlign: state.lyricsAlign,
        showTranslatedLyrics: state.showTranslatedLyrics,
        showRomanizedLyrics: state.showRomanizedLyrics,
        nowPlayingBackgroundBlurEnabled: state.nowPlayingBackgroundBlurEnabled,
        maxCacheGb: state.maxCacheGb,
        globalShortcutsEnabled: state.globalShortcutsEnabled,
        playPauseShortcut: state.playPauseShortcut,
        nextTrackShortcut: state.nextTrackShortcut,
        previousTrackShortcut: state.previousTrackShortcut,
        scrobbleProvider: state.scrobbleProvider,
        lastFmApiKey: state.lastFmApiKey,
        lastFmApiSecret: state.lastFmApiSecret,
        lastFmSessionKey: state.lastFmSessionKey,
        listenBrainzToken: state.listenBrainzToken,
        desktopLyricsEnabled: state.desktopLyricsEnabled,
        replayGainMode: state.replayGainMode,
        playbackSpeed: state.playbackSpeed,
        fadeDurationSec: state.fadeDurationSec,
      }),
    },
  ),
);
