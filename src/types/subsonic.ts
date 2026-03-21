export type SubsonicAlbum = {
  id: string;
  name: string;
  artist?: string;
  artistId?: string;
  songCount?: number;
  duration?: number;
  coverArt?: string;
  created?: string;
  year?: number;
};

export type SubsonicSong = {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  albumId?: string;
  coverArt?: string;
  duration?: number;
  track?: number;
  year?: number;
  contentType?: string;
  suffix?: string;
  bitRate?: number;
  path?: string;
  replayGainTrackGain?: number | string;
  replayGainAlbumGain?: number | string;
};

export type SubsonicResponseEnvelope<T> = {
  "subsonic-response": {
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
};
