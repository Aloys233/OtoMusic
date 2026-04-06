export type AudioQualityTier = "lossless" | "hires-lossless";

export type AudioQualityInfo = {
  tier: AudioQualityTier;
  label: "无损" | "Hi-Res 无损";
  bitDepth: number;
  sampleRate: number;
  parameterText?: string;
};

type AudioQualityCandidate = {
  suffix?: string;
  bitDepth?: number | string;
  sampleRate?: number | string;
  samplingRate?: number | string;
};

const LOSSY_SUFFIXES = new Set(["mp3", "aac", "ogg", "opus"]);
const LOSSLESS_SUFFIXES = new Set([
  "flac",
  "alac",
  "wav",
  "wave",
  "aiff",
  "aif",
  "ape",
  "wv",
  "tta",
  "tak",
  "dsd",
  "dsf",
  "dff",
]);
const HI_RES_SAMPLE_RATE_FLOOR = 48_000;

function normalizeSuffix(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeInteger(value: number | string | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value) : null;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
  }

  return null;
}

function formatSampleRateKHz(sampleRate: number) {
  const kiloHertz = sampleRate / 1000;
  return Number.isInteger(kiloHertz) ? `${kiloHertz}kHz` : `${kiloHertz.toFixed(1)}kHz`;
}

export function resolveAudioQuality(candidate: AudioQualityCandidate): AudioQualityInfo | null {
  const suffix = normalizeSuffix(candidate.suffix);
  if (!suffix || LOSSY_SUFFIXES.has(suffix) || !LOSSLESS_SUFFIXES.has(suffix)) {
    return null;
  }

  const bitDepth = normalizeInteger(candidate.bitDepth);
  const sampleRate = normalizeInteger(candidate.sampleRate ?? candidate.samplingRate);
  if (!bitDepth || !sampleRate) {
    return null;
  }

  if (bitDepth >= 24 && sampleRate > HI_RES_SAMPLE_RATE_FLOOR) {
    return {
      tier: "hires-lossless",
      label: "Hi-Res 无损",
      bitDepth,
      sampleRate,
      parameterText: `${bitDepth}-bit/${formatSampleRateKHz(sampleRate)}`,
    };
  }

  if (bitDepth <= 24 && sampleRate <= HI_RES_SAMPLE_RATE_FLOOR) {
    return {
      tier: "lossless",
      label: "无损",
      bitDepth,
      sampleRate,
    };
  }

  return null;
}
