import type { SubsonicClient } from "@/lib/api/subsonic-client";
import type { TrackInfo } from "@/stores/player-store";
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

export function mapSongToTrackInfo(song: SubsonicSong, client: SubsonicClient): TrackInfo {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist ?? "Unknown Artist",
    duration: song.duration ?? 0,
    coverArtId: song.coverArt,
    coverUrl: song.coverArt ? client.getCoverArtUrl(song.coverArt, 192) : undefined,
    streamUrl: client.getStreamUrl(song.id, 0),
    trackGainDb: parseGain(song.replayGainTrackGain),
    albumGainDb: parseGain(song.replayGainAlbumGain),
  };
}
