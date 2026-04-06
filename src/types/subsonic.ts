export type SubsonicAlbum = {
  id: string;
  name: string;
  artist?: string;
  artistId?: string;
  genre?: string;
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
  artistId?: string;
  album?: string;
  albumId?: string;
  coverArt?: string;
  duration?: number;
  track?: number;
  year?: number;
  genre?: string;
  contentType?: string;
  suffix?: string;
  bitRate?: number;
  bitDepth?: number;
  sampleRate?: number;
  samplingRate?: number;
  path?: string;
  replayGainTrackGain?: number | string;
  replayGainAlbumGain?: number | string;
  starred?: string;
};

export type SubsonicGenre = {
  value?: string;
  songCount?: number;
  albumCount?: number;
};

export type SubsonicMusicFolder = {
  id: string;
  name?: string;
};

export type SubsonicPlaylist = {
  id: string;
  name: string;
  comment?: string;
  owner?: string;
  public?: boolean;
  songCount?: number;
  duration?: number;
  created?: string;
  changed?: string;
  coverArt?: string;
};

export type SubsonicArtistInfo2 = {
  biography?: string;
  musicBrainzId?: string;
  lastFmUrl?: string;
  smallImageUrl?: string;
  mediumImageUrl?: string;
  largeImageUrl?: string;
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
