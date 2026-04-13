import type { SubsonicClient } from "@/lib/api/subsonic-client";
import type { TrackInfo } from "@/stores/player-store";
import { resolveMaxBitrateKbps, useSettingsStore } from "@/stores/settings-store";
import type { SubsonicSong } from "@/types/subsonic";

function parseGain(value: number | string | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace("dB", "").trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function parsePeak(value: number | string | undefined) {
  const peak = parseGain(value);
  if (typeof peak !== "number" || peak <= 0) {
    return undefined;
  }
  return peak;
}

export function mapSongToTrackInfo(song: SubsonicSong, client: SubsonicClient): TrackInfo {
  const streamQuality = useSettingsStore.getState().streamQuality;
  const maxBitrate = resolveMaxBitrateKbps(streamQuality);

  return {
    id: song.id,
    title: song.title,
    artist: song.artist ?? "Unknown Artist",
    album: song.album,
    albumId: song.albumId,
    genre: song.genre,
    duration: song.duration ?? 0,
    coverArtId: song.coverArt,
    coverUrl: song.coverArt ? client.getCoverArtUrl(song.coverArt, 192) : undefined,
    streamUrl: client.getStreamUrl(song.id, maxBitrate),
    trackGainDb: parseGain(song.replayGainTrackGain),
    albumGainDb: parseGain(song.replayGainAlbumGain),
    trackPeak: parsePeak(song.replayGainTrackPeak),
    albumPeak: parsePeak(song.replayGainAlbumPeak),
    bitRate: song.bitRate,
    bitDepth: song.bitDepth,
    sampleRate: song.sampleRate ?? song.samplingRate,
    suffix: song.suffix,
  };
}
