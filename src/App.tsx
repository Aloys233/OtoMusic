import { useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import {
  AudioLines,
  ArrowLeft,
  CalendarDays,
  Clock3,
  Disc3,
  Download,
  FolderTree,
  Heart,
  ListMusic,
  Loader2,
  Mic2,
  Music2,
  Shuffle,
  Tags,
} from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useState, useCallback, useRef } from "react";

import { LoginPanel } from "@/features/auth/components/LoginPanel";
import { PlayerBar } from "@/components/layout/PlayerBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { WindowTitlebar } from "@/components/layout/WindowTitlebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { envDefaults } from "@/config/env";
import { useAllSongs } from "@/features/library/hooks/use-all-songs";
import { useAlbumList } from "@/features/library/hooks/use-album-list";
import { useAlbumSongs } from "@/features/library/hooks/use-album-songs";
import { useGenres } from "@/features/library/hooks/use-genres";
import { useGlobalSearch } from "@/features/library/hooks/use-global-search";
import { useLovedTracks } from "@/features/library/hooks/use-loved-tracks";
import { useLyrics } from "@/features/library/hooks/use-lyrics";
import { useMusicFolders } from "@/features/library/hooks/use-music-folders";
import { usePlaylistDetail } from "@/features/library/hooks/use-playlist-detail";
import { usePlaylists } from "@/features/library/hooks/use-playlists";
import { useArtistInfo } from "@/features/library/hooks/use-artist-info";
import { AlbumGridItem } from "@/features/library/components/AlbumGridItem";
import { SongListItem } from "@/features/library/components/SongListItem";
import { resolveAudioQuality } from "@/features/player/utils/audio-quality";
import { mapSongToTrackInfo } from "@/features/player/utils/map-subsonic-song";
import { useDominantColor } from "@/hooks/use-dominant-color";
import { useMediaSession } from "@/hooks/use-media-session";
import { useScrobbling } from "@/hooks/use-scrobbling";
import { useSmoothScroll } from "@/hooks/use-smooth-scroll";
import { useTrayControls } from "@/hooks/use-tray-controls";
import { useUpdateChecker } from "@/hooks/use-update-checker";
import { createSubsonicClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { type LibraryNavSection, useLibraryStore } from "@/stores/library-store";
import { usePlayerStore } from "@/stores/player-store";
import { useRecentPlayStore } from "@/stores/recent-play-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { SubsonicAlbum, SubsonicSong } from "@/types/subsonic";


type AlbumCard = {
  id: string;
  title: string;
  artist: string;
  genre?: string;
  coverArt?: string;
  songCount?: number;
  duration?: number;
  year?: number;
  createdAt: number;
};

function parseAlbumCreatedAt(created?: string) {
  if (!created) {
    return 0;
  }

  const parsed = Date.parse(created);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toCardItem(album: SubsonicAlbum): AlbumCard {
  return {
    id: album.id,
    title: album.name,
    artist: album.artist ?? "未知艺术家",
    genre: album.genre,
    coverArt: album.coverArt,
    songCount: album.songCount,
    duration: album.duration,
    year: album.year,
    createdAt: parseAlbumCreatedAt(album.created),
  };
}

function formatTime(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分`;
  }

  return `${minutes} 分钟`;
}

function getSongArtistNames(song: SubsonicSong) {
  const names = song.artists
    ?.map((artist) => artist.name.trim())
    .filter(Boolean);

  if (names && names.length > 0) {
    return Array.from(new Set(names));
  }

  const fallbackName = song.displayArtist?.trim() || song.artist?.trim();
  return fallbackName ? [fallbackName] : ["未知艺术家"];
}

function formatDateTime(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString("zh-CN", {
    hour12: false,
  });
}

function getArtistInitials(artist: string) {
  const trimmed = artist.trim();
  if (!trimmed) {
    return "A";
  }

  const hasChinese = /[\u4e00-\u9fa5]/.test(trimmed);
  if (hasChinese) {
    return Array.from(trimmed).slice(0, 2).join("");
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }

  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
}

function shuffleArray<T>(input: T[]) {
  const next = [...input];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function matchKeyword(keyword: string, ...values: Array<string | undefined>) {
  if (!keyword.trim()) {
    return true;
  }

  const normalized = keyword.trim().toLowerCase();
  return values.some((value) => value?.toLowerCase().includes(normalized));
}

function normalizeRange(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return fallback;
  }

  const normalized = (value - min) / (max - min);
  return Math.min(1, Math.max(0, normalized));
}

function hashToUnitInterval(input: string) {
  let hash = 2166136261;

  for (const char of input) {
    hash ^= char.charCodeAt(0);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  return (hash >>> 0) / 4294967295;
}

function getAlbumColumns(viewportWidth: number) {
  if (viewportWidth >= 1280) {
    return 6;
  }

  if (viewportWidth >= 768) {
    return 3;
  }

  return 2;
}

const ALBUM_ROWS_PER_PAGE = 4;
const SONGS_PER_PAGE = 60;
const LazyNowPlayingSheet = lazy(async () => {
  const module = await import("@/features/player/components/NowPlayingSheet");
  return { default: module.NowPlayingSheet };
});
const LazySettingsPanel = lazy(async () => {
  const module = await import("@/components/layout/SettingsPanel");
  return { default: module.SettingsPanel };
});

function parseColorToRgb(color: string) {
  const hex = color.trim().toLowerCase();
  const fullHex = hex.match(/^#([0-9a-f]{6})$/i);
  if (fullHex) {
    const raw = fullHex[1];
    return {
      r: Number.parseInt(raw.slice(0, 2), 16),
      g: Number.parseInt(raw.slice(2, 4), 16),
      b: Number.parseInt(raw.slice(4, 6), 16),
    };
  }

  const shortHex = hex.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) {
    const [r, g, b] = shortHex[1].split("");
    return {
      r: Number.parseInt(`${r}${r}`, 16),
      g: Number.parseInt(`${g}${g}`, 16),
      b: Number.parseInt(`${b}${b}`, 16),
    };
  }

  const rgb = color.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (rgb) {
    return {
      r: Number.parseInt(rgb[1], 10),
      g: Number.parseInt(rgb[2], 10),
      b: Number.parseInt(rgb[3], 10),
    };
  }

  return {
    r: 16,
    g: 185,
    b: 129,
  };
}

export default function App() {
  useMediaSession();
  useTrayControls();

  const mainRef = useRef<HTMLElement>(null);
  const goBackRef = useRef<() => void>(() => {});
  const goForwardRef = useRef<() => void>(() => {});
  const hasAutoCheckedUpdateRef = useRef(false);
  useSmoothScroll(mainRef);

  const session = useAuthStore((state) => state.session);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoggingIn = useAuthStore((state) => state.isLoggingIn);
  const isRestoringSession = useAuthStore((state) => state.isRestoringSession);
  const loginError = useAuthStore((state) => state.loginError);
  const login = useAuthStore((state) => state.login);
  const restoreSecureSession = useAuthStore((state) => state.restoreSecureSession);
  const clearLoginError = useAuthStore((state) => state.clearLoginError);

  const selectedAlbumId = useLibraryStore((state) => state.selectedAlbumId);
  const setSelectedAlbumId = useLibraryStore((state) => state.setSelectedAlbumId);
  const searchKeyword = useLibraryStore((state) => state.searchKeyword);
  const setSearchKeyword = useLibraryStore((state) => state.setSearchKeyword);
  const activeNavSection = useLibraryStore((state) => state.activeNavSection);
  const setActiveNavSection = useLibraryStore((state) => state.setActiveNavSection);

  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const currentTrackId = currentTrack?.id;
  const queue = usePlayerStore((state) => state.queue);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const setQueue = usePlayerStore((state) => state.setQueue);
  const setPlaying = usePlayerStore((state) => state.setPlaying);
  const playTrackById = usePlayerStore((state) => state.playTrackById);
  const recentPlays = useRecentPlayStore((state) => state.recentPlays);
  const recordRecentPlay = useRecentPlayStore((state) => state.recordPlay);
  const accentColor = useSettingsStore((state) => state.accentColor);
  const accentSource = useSettingsStore((state) => state.accentSource);
  const lyricsFontScale = useSettingsStore((state) => state.lyricsFontScale);
  const lyricsAlign = useSettingsStore((state) => state.lyricsAlign);
  const showTranslatedLyrics = useSettingsStore((state) => state.showTranslatedLyrics);
  const showRomanizedLyrics = useSettingsStore((state) => state.showRomanizedLyrics);
  const nowPlayingBackgroundBlurEnabled = useSettingsStore(
    (state) => state.nowPlayingBackgroundBlurEnabled,
  );

  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );
  const [isNowPlayingSheetOpen, setNowPlayingSheetOpen] = useState(false);
  const [isSettingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [hasLoadedNowPlayingSheet, setHasLoadedNowPlayingSheet] = useState(false);
  const [hasLoadedSettingsPanel, setHasLoadedSettingsPanel] = useState(false);
  const [isRefreshingLibrary, setRefreshingLibrary] = useState(false);
  const [isBioExpanded, setBioExpanded] = useState(false);
  const [artistImageLoadFailed, setArtistImageLoadFailed] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearchInput, setDebouncedSearchInput] = useState("");
  const [selectedArtistName, setSelectedArtistName] = useState<string | null>(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [navHistory, setNavHistory] = useState<{
    stack: LibraryNavSection[];
    index: number;
  }>({
    stack: ["for-you"],
    index: 0,
  });
  const queryClient = useQueryClient();
  const updateChecker = useUpdateChecker();

  useEffect(() => {
    void restoreSecureSession();
  }, [restoreSecureSession]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onResize = () => {
      setViewportWidth(window.innerWidth);
    };

    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    if (hasAutoCheckedUpdateRef.current) {
      return;
    }

    hasAutoCheckedUpdateRef.current = true;
    void updateChecker.checkForUpdate();
  }, [updateChecker.checkForUpdate]);

  useEffect(() => {
    if (isNowPlayingSheetOpen) {
      setHasLoadedNowPlayingSheet(true);
    }
  }, [isNowPlayingSheetOpen]);

  useEffect(() => {
    if (isSettingsPanelOpen) {
      setHasLoadedSettingsPanel(true);
    }
  }, [isSettingsPanelOpen]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchInput(searchInput);
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [searchInput]);

  const client = useMemo(() => {
    if (!isAuthenticated || !session?.password) {
      return null;
    }

    return createSubsonicClient(session);
  }, [isAuthenticated, session]);

  const sessionKey = isAuthenticated && session?.password
    ? `${session.baseUrl}|${session.username}`
    : null;

  const {
    data: albumPageData,
    isLoading: albumLoading,
    isError: albumError,
    error: albumErrorObj,
    hasNextPage: hasMoreAlbumPages,
    isFetchingNextPage: albumLoadingMore,
    fetchNextPage: fetchNextAlbumPage,
  } = useAlbumList(client, sessionKey);

  const albumData = useMemo(
    () => albumPageData?.pages.flatMap((page) => page) ?? [],
    [albumPageData],
  );
  const albumIds = useMemo(() => albumData.map((album) => album.id), [albumData]);
  const isAllSongsCatalogReady = !albumLoading && !albumLoadingMore && !hasMoreAlbumPages;

  const {
    data: albumSongsData = [],
    isLoading: albumSongsLoading,
    isError: albumSongsError,
    error: albumSongsErrorObj,
  } = useAlbumSongs(client, sessionKey, selectedAlbumId);
  const {
    data: allSongsData = [],
    isLoading: allSongsLoading,
    isFetching: allSongsFetching,
    isError: allSongsError,
    error: allSongsErrorObj,
  } = useAllSongs(
    client,
    sessionKey,
    albumIds,
    isAllSongsCatalogReady,
  );
  const songSourceData = activeNavSection === "songs" ? allSongsData : albumSongsData;
  const songsLoading = activeNavSection === "songs"
    ? albumLoading || albumLoadingMore || Boolean(hasMoreAlbumPages) || allSongsLoading || allSongsFetching
    : albumSongsLoading;
  const songsError = activeNavSection === "songs" ? allSongsError : albumSongsError;
  const songsErrorObj = activeNavSection === "songs" ? allSongsErrorObj : albumSongsErrorObj;
  const normalizedSearchKeyword = searchKeyword.trim();
  const normalizedSearchInput = searchInput.trim();
  const normalizedDebouncedSearchInput = debouncedSearchInput.trim();
  const normalizedSelectedArtistName = selectedArtistName?.trim() ?? "";
  const {
    data: globalSearchData = { albums: [], songs: [] },
    isLoading: globalSearchLoading,
    isError: globalSearchError,
    error: globalSearchErrorObj,
  } = useGlobalSearch(client, sessionKey, normalizedSearchKeyword);
  const {
    data: suggestionSearchData = { albums: [], songs: [] },
  } = useGlobalSearch(client, sessionKey, normalizedDebouncedSearchInput);
  const {
    data: artistDetailSearchData = { albums: [], songs: [] },
    isLoading: artistDetailLoading,
    isError: artistDetailError,
    error: artistDetailErrorObj,
  } = useGlobalSearch(
    client,
    sessionKey,
    activeNavSection === "artist-detail" ? normalizedSelectedArtistName : "",
  );
  const {
    data: lovedTracksData = [],
    isLoading: lovedTracksLoading,
    isError: lovedTracksError,
    error: lovedTracksErrorObj,
  } = useLovedTracks(client, sessionKey);
  const {
    data: genresData = [],
    isLoading: genresLoading,
    isError: genresError,
    error: genresErrorObj,
  } = useGenres(client, sessionKey);
  const {
    data: musicFoldersData = [],
    isLoading: musicFoldersLoading,
    isError: musicFoldersError,
    error: musicFoldersErrorObj,
  } = useMusicFolders(client, sessionKey);
  const {
    data: playlistsData = [],
    isLoading: playlistsLoading,
    isError: playlistsError,
    error: playlistsErrorObj,
  } = usePlaylists(client, sessionKey);
  const {
    data: playlistDetailData,
    isLoading: playlistDetailLoading,
    isError: playlistDetailError,
    error: playlistDetailErrorObj,
  } = usePlaylistDetail(client, sessionKey, selectedPlaylistId);

  const artistDetailArtistId = useMemo(() => {
    if (!normalizedSelectedArtistName) return undefined;
    const keyword = normalizedSelectedArtistName.toLowerCase();
    const exactAlbumArtistId = artistDetailSearchData.albums.find(
      (album) => album.artistId && album.artist?.trim().toLowerCase() === keyword,
    )?.artistId;
    if (exactAlbumArtistId) {
      return exactAlbumArtistId;
    }

    const exactSongArtistId = artistDetailSearchData.songs.find(
      (song) => song.artistId && song.artist?.trim().toLowerCase() === keyword,
    )?.artistId;
    if (exactSongArtistId) {
      return exactSongArtistId;
    }

    return artistDetailSearchData.albums.find((album) => album.artistId)?.artistId ??
      artistDetailSearchData.songs.find((song) => song.artistId)?.artistId;
  }, [artistDetailSearchData.albums, artistDetailSearchData.songs, normalizedSelectedArtistName]);

  const { data: artistInfoData } = useArtistInfo(client, sessionKey, artistDetailArtistId);

  const albumCards = useMemo(() => albumData.map(toCardItem), [albumData]);

  const filteredAlbums = useMemo(
    () => albumCards.filter((album) => matchKeyword(searchKeyword, album.title, album.artist, album.genre)),
    [albumCards, searchKeyword],
  );
  const recentPlayedAlbums = useMemo(() => {
    if (!sessionKey || albumCards.length === 0) {
      return [];
    }

    const albumById = new Map(albumCards.map((album) => [album.id, album]));
    const pickedAlbumIds = new Set<string>();
    const pickedAlbums: AlbumCard[] = [];

    for (const entry of recentPlays) {
      if (entry.sessionKey !== sessionKey) {
        continue;
      }

      const albumId = entry.albumId?.trim();
      if (!albumId || pickedAlbumIds.has(albumId)) {
        continue;
      }

      const album = albumById.get(albumId);
      if (!album) {
        continue;
      }

      if (!matchKeyword(searchKeyword, album.title, album.artist, album.genre)) {
        continue;
      }

      pickedAlbums.push(album);
      pickedAlbumIds.add(albumId);
    }

    return pickedAlbums;
  }, [albumCards, recentPlays, searchKeyword, sessionKey]);

  const visibleSongs = useMemo(
    () =>
      [...songSourceData].sort((a, b) => {
        if (activeNavSection === "songs") {
          const artistGap = (a.artist ?? "").localeCompare(b.artist ?? "");
          if (artistGap !== 0) {
            return artistGap;
          }

          const albumGap = (a.album ?? "").localeCompare(b.album ?? "");
          if (albumGap !== 0) {
            return albumGap;
          }
        }

        return (a.track ?? Number.MAX_SAFE_INTEGER) - (b.track ?? Number.MAX_SAFE_INTEGER);
      }),
    [activeNavSection, songSourceData],
  );

  const filteredSongs = useMemo(
    () =>
      visibleSongs.filter((song) =>
        matchKeyword(searchKeyword, song.title, song.artist, song.album),
      ),
    [searchKeyword, visibleSongs],
  );
  const [songPageIndex, setSongPageIndex] = useState(0);
  const songPageCount = useMemo(
    () => Math.max(1, Math.ceil(filteredSongs.length / SONGS_PER_PAGE)),
    [filteredSongs.length],
  );
  const currentSongPageIndex = Math.min(songPageIndex, Math.max(0, songPageCount - 1));
  const songPageStart = currentSongPageIndex * SONGS_PER_PAGE;
  const displayedSongs = useMemo(
    () => filteredSongs.slice(songPageStart, songPageStart + SONGS_PER_PAGE),
    [filteredSongs, songPageStart],
  );

  useEffect(() => {
    if (songPageIndex === currentSongPageIndex) {
      return;
    }

    setSongPageIndex(currentSongPageIndex);
  }, [songPageIndex, currentSongPageIndex]);

  useEffect(() => {
    if (activeNavSection !== "songs" && activeNavSection !== "album-detail") {
      return;
    }

    setSongPageIndex(0);
  }, [activeNavSection, selectedAlbumId, normalizedSearchKeyword]);

  const filteredLovedTracks = useMemo(
    () =>
      lovedTracksData.filter((song) =>
        matchKeyword(searchKeyword, song.title, song.artist, song.album),
      ),
    [lovedTracksData, searchKeyword],
  );
  const genreSummaries = useMemo(() => {
    const genreMap = new Map<
      string,
      {
        name: string;
        albumCount: number;
        songCount: number;
      }
    >();

    for (const genre of genresData) {
      const name = genre.value?.trim();
      if (!name) {
        continue;
      }

      genreMap.set(name, {
        name,
        albumCount: genre.albumCount ?? 0,
        songCount: genre.songCount ?? 0,
      });
    }

    for (const album of albumCards) {
      const name = album.genre?.trim();
      if (!name) {
        continue;
      }

      const current = genreMap.get(name);
      if (!current) {
        genreMap.set(name, {
          name,
          albumCount: 1,
          songCount: album.songCount ?? 0,
        });
        continue;
      }

      genreMap.set(name, {
        name,
        albumCount: current.albumCount + 1,
        songCount: current.songCount + (album.songCount ?? 0),
      });
    }

    return Array.from(genreMap.values())
      .filter((genre) => matchKeyword(searchKeyword, genre.name))
      .sort((a, b) => {
        const songCountGap = b.songCount - a.songCount;
        if (songCountGap !== 0) {
          return songCountGap;
        }

        const albumCountGap = b.albumCount - a.albumCount;
        if (albumCountGap !== 0) {
          return albumCountGap;
        }

        return a.name.localeCompare(b.name);
      });
  }, [albumCards, genresData, searchKeyword]);
  const derivedFolders = useMemo(() => {
    const folderMap = new Map<string, number>();
    for (const song of visibleSongs) {
      const path = song.path?.trim();
      if (!path) {
        continue;
      }

      const normalizedPath = path.replace(/\\/g, "/");
      const separatorIndex = normalizedPath.lastIndexOf("/");
      if (separatorIndex <= 0) {
        continue;
      }

      const folderPath = normalizedPath.slice(0, separatorIndex);
      folderMap.set(folderPath, (folderMap.get(folderPath) ?? 0) + 1);
    }

    return Array.from(folderMap.entries()).map(([path, songCount]) => ({
      id: path,
      name: path,
      songCount,
      source: "derived" as const,
    }));
  }, [visibleSongs]);
  const folderSummaries = useMemo(() => {
    const serverFolders = musicFoldersData.map((folder) => ({
      id: folder.id,
      name: folder.name?.trim() || `Folder ${folder.id}`,
      songCount: null as number | null,
      source: "server" as const,
    }));

    const base = serverFolders.length > 0 ? serverFolders : derivedFolders;
    return base
      .filter((folder) => matchKeyword(searchKeyword, folder.name))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [derivedFolders, musicFoldersData, searchKeyword]);

  const artistSummaries = useMemo(() => {
    const map = new Map<
      string,
      {
        artist: string;
        albumCount: number;
        songCount: number;
        latestYear: number | null;
      }
    >();

    for (const album of albumCards) {
      const current = map.get(album.artist);
      const nextYear = album.year ?? null;

      if (!current) {
        map.set(album.artist, {
          artist: album.artist,
          albumCount: 1,
          songCount: album.songCount ?? 0,
          latestYear: nextYear,
        });
        continue;
      }

      const latestYear = nextYear === null
        ? current.latestYear
        : current.latestYear === null
          ? nextYear
          : Math.max(current.latestYear, nextYear);

      map.set(album.artist, {
        artist: current.artist,
        albumCount: current.albumCount + 1,
        songCount: current.songCount + (album.songCount ?? 0),
        latestYear,
      });
    }

    return Array.from(map.values())
      .filter((artist) => matchKeyword(debouncedSearchInput, artist.artist))
      .sort((a, b) => {
        const albumGap = b.albumCount - a.albumCount;
        if (albumGap !== 0) {
          return albumGap;
        }

        const songGap = b.songCount - a.songCount;
        if (songGap !== 0) {
          return songGap;
        }

        return a.artist.localeCompare(b.artist);
      });
  }, [albumCards, debouncedSearchInput]);

  const recommendationSeedKey = useMemo(() => {
    const now = new Date();
    const month = `${now.getMonth() + 1}`.padStart(2, "0");
    const day = `${now.getDate()}`.padStart(2, "0");
    return `${now.getFullYear()}-${month}-${day}`;
  }, []);
  const discoverRecommendedAlbums = useMemo(() => {
    if (filteredAlbums.length === 0) {
      return [];
    }

    const songCounts = filteredAlbums.map((album) => album.songCount ?? 0);
    const durations = filteredAlbums.map((album) => album.duration ?? 0);
    const validYears = filteredAlbums.map((album) => album.year ?? 0).filter((year) => year > 0);
    const validCreatedAt = filteredAlbums
      .map((album) => album.createdAt)
      .filter((createdAt) => createdAt > 0);

    const songCountMin = Math.min(...songCounts);
    const songCountMax = Math.max(...songCounts);
    const durationMin = Math.min(...durations);
    const durationMax = Math.max(...durations);
    const yearMin = validYears.length > 0 ? Math.min(...validYears) : 0;
    const yearMax = validYears.length > 0 ? Math.max(...validYears) : 0;
    const createdAtMin = validCreatedAt.length > 0 ? Math.min(...validCreatedAt) : 0;
    const createdAtMax = validCreatedAt.length > 0 ? Math.max(...validCreatedAt) : 0;

    const scored = filteredAlbums
      .map((album) => {
        const songScore = normalizeRange(album.songCount ?? 0, songCountMin, songCountMax, 0.35);
        const durationScore = normalizeRange(album.duration ?? 0, durationMin, durationMax, 0.25);
        const yearScore = album.year
          ? normalizeRange(album.year, yearMin, yearMax, 0.4)
          : 0.4;
        const recencyScore = album.createdAt > 0
          ? normalizeRange(album.createdAt, createdAtMin, createdAtMax, 0.5)
          : 0.5;
        const randomScore = hashToUnitInterval(`${recommendationSeedKey}:${album.id}`);

        return {
          album,
          score:
            songScore * 0.34 +
            durationScore * 0.23 +
            yearScore * 0.16 +
            recencyScore * 0.12 +
            randomScore * 0.15,
        };
      })
      .sort((a, b) => {
        const scoreGap = b.score - a.score;
        if (scoreGap !== 0) {
          return scoreGap;
        }

        const songCountGap = (b.album.songCount ?? 0) - (a.album.songCount ?? 0);
        if (songCountGap !== 0) {
          return songCountGap;
        }

        const createdAtGap = b.album.createdAt - a.album.createdAt;
        if (createdAtGap !== 0) {
          return createdAtGap;
        }

        return a.album.title.localeCompare(b.album.title);
      });

    const picked: AlbumCard[] = [];
    const pickedArtistKeys = new Set<string>();

    for (const item of scored) {
      const artistKey = item.album.artist.trim().toLowerCase();
      if (pickedArtistKeys.has(artistKey)) {
        continue;
      }

      picked.push(item.album);
      pickedArtistKeys.add(artistKey);

      if (picked.length >= 12) {
        return picked;
      }
    }

    const pickedAlbumIds = new Set(picked.map((album) => album.id));
    for (const item of scored) {
      if (pickedAlbumIds.has(item.album.id)) {
        continue;
      }

      picked.push(item.album);
      if (picked.length >= 12) {
        break;
      }
    }

    return picked;
  }, [filteredAlbums, recommendationSeedKey]);
  const discoverCollectionAlbums = useMemo(
    () =>
      [...filteredAlbums]
        .sort((a, b) => {
          const songCountGap = (b.songCount ?? 0) - (a.songCount ?? 0);
          if (songCountGap !== 0) {
            return songCountGap;
          }

          return b.createdAt - a.createdAt;
        })
        .slice(0, 12),
    [filteredAlbums],
  );
  const forYouAlbumIds = useMemo(() => {
    const ids = new Set<string>();
    for (const album of discoverRecommendedAlbums) {
      ids.add(album.id);
    }
    for (const album of discoverCollectionAlbums) {
      ids.add(album.id);
    }
    return ids;
  }, [discoverCollectionAlbums, discoverRecommendedAlbums]);
  const forYouExploreAlbums = useMemo(() => {
    const uniqueById = new Map<string, AlbumCard>();
    for (const album of [...discoverRecommendedAlbums, ...discoverCollectionAlbums]) {
      if (!uniqueById.has(album.id)) {
        uniqueById.set(album.id, album);
      }
    }
    return Array.from(uniqueById.values());
  }, [discoverCollectionAlbums, discoverRecommendedAlbums]);
  const discoverPoolAlbums = useMemo(
    () => filteredAlbums.filter((album) => !forYouAlbumIds.has(album.id)),
    [filteredAlbums, forYouAlbumIds],
  );
  const discoverGenreSections = useMemo(() => {
    const genreMap = new Map<string, AlbumCard[]>();

    for (const album of discoverPoolAlbums) {
      const genre = album.genre?.trim();
      if (!genre) {
        continue;
      }

      const list = genreMap.get(genre);
      if (list) {
        list.push(album);
      } else {
        genreMap.set(genre, [album]);
      }
    }

    const sections = Array.from(genreMap.entries())
      .map(([genre, albums]) => {
        const songCounts = albums.map((album) => album.songCount ?? 0);
        const durations = albums.map((album) => album.duration ?? 0);
        const validYears = albums.map((album) => album.year ?? 0).filter((year) => year > 0);
        const validCreatedAt = albums.map((album) => album.createdAt).filter((createdAt) => createdAt > 0);

        const songCountMin = Math.min(...songCounts);
        const songCountMax = Math.max(...songCounts);
        const durationMin = Math.min(...durations);
        const durationMax = Math.max(...durations);
        const yearMin = validYears.length > 0 ? Math.min(...validYears) : 0;
        const yearMax = validYears.length > 0 ? Math.max(...validYears) : 0;
        const createdAtMin = validCreatedAt.length > 0 ? Math.min(...validCreatedAt) : 0;
        const createdAtMax = validCreatedAt.length > 0 ? Math.max(...validCreatedAt) : 0;

        const topAlbums = [...albums]
          .sort((a, b) => {
            const aSongScore = normalizeRange(a.songCount ?? 0, songCountMin, songCountMax, 0.4);
            const bSongScore = normalizeRange(b.songCount ?? 0, songCountMin, songCountMax, 0.4);
            const aDurationScore = normalizeRange(a.duration ?? 0, durationMin, durationMax, 0.3);
            const bDurationScore = normalizeRange(b.duration ?? 0, durationMin, durationMax, 0.3);
            const aYearScore = a.year ? normalizeRange(a.year, yearMin, yearMax, 0.35) : 0.35;
            const bYearScore = b.year ? normalizeRange(b.year, yearMin, yearMax, 0.35) : 0.35;
            const aRecencyScore = a.createdAt > 0
              ? normalizeRange(a.createdAt, createdAtMin, createdAtMax, 0.45)
              : 0.45;
            const bRecencyScore = b.createdAt > 0
              ? normalizeRange(b.createdAt, createdAtMin, createdAtMax, 0.45)
              : 0.45;
            const aRandomScore = hashToUnitInterval(`${recommendationSeedKey}:${genre}:${a.id}`);
            const bRandomScore = hashToUnitInterval(`${recommendationSeedKey}:${genre}:${b.id}`);

            const aScore = aSongScore * 0.38 + aDurationScore * 0.22 + aYearScore * 0.18 + aRecencyScore * 0.12 + aRandomScore * 0.1;
            const bScore = bSongScore * 0.38 + bDurationScore * 0.22 + bYearScore * 0.18 + bRecencyScore * 0.12 + bRandomScore * 0.1;

            const scoreGap = bScore - aScore;
            if (scoreGap !== 0) {
              return scoreGap;
            }

            return a.title.localeCompare(b.title);
          })
          .slice(0, 12);

        const artistCount = new Set(albums.map((album) => album.artist.trim().toLowerCase())).size;
        const minYear = validYears.length > 0 ? Math.min(...validYears) : null;
        const maxYear = validYears.length > 0 ? Math.max(...validYears) : null;
        const yearRange = minYear && maxYear
          ? minYear === maxYear
            ? `${minYear}`
            : `${minYear}-${maxYear}`
          : null;

        return {
          key: genre.toLowerCase(),
          genre,
          albumCount: albums.length,
          artistCount,
          yearRange,
          albums: topAlbums,
        };
      })
      .sort((a, b) => {
        const albumCountGap = b.albumCount - a.albumCount;
        if (albumCountGap !== 0) {
          return albumCountGap;
        }

        const artistCountGap = b.artistCount - a.artistCount;
        if (artistCountGap !== 0) {
          return artistCountGap;
        }

        return a.genre.localeCompare(b.genre);
      });

    return sections.slice(0, 4);
  }, [discoverPoolAlbums, recommendationSeedKey]);
  const discoverFreshAlbums = useMemo(
    () =>
      [...discoverPoolAlbums]
        .sort((a, b) => {
          const yearGap = (b.year ?? 0) - (a.year ?? 0);
          if (yearGap !== 0) {
            return yearGap;
          }

          const createdAtGap = b.createdAt - a.createdAt;
          if (createdAtGap !== 0) {
            return createdAtGap;
          }

          return (b.songCount ?? 0) - (a.songCount ?? 0);
        })
        .slice(0, 18),
    [discoverPoolAlbums],
  );

  useEffect(() => {
    if (isAuthenticated) {
      return;
    }

    setSelectedAlbumId(null);
    setSelectedArtistName(null);
    setSelectedPlaylistId(null);
    setSearchInput("");
    setDebouncedSearchInput("");
    setSearchKeyword("");
    setActiveNavSection("for-you");
    setNowPlayingSheetOpen(false);
    setSettingsPanelOpen(false);
    setNavHistory({
      stack: ["for-you"],
      index: 0,
    });
    setQueue([], 0);
    setPlaying(false);
  }, [
    isAuthenticated,
    setActiveNavSection,
    setNavHistory,
    setSettingsPanelOpen,
    setPlaying,
    setQueue,
    setDebouncedSearchInput,
    setSearchInput,
    setSearchKeyword,
    setSelectedAlbumId,
    setSelectedPlaylistId,
    setSelectedArtistName,
  ]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    setSelectedAlbumId(null);
    setSelectedArtistName(null);
    setSelectedPlaylistId(null);
  }, [sessionKey, isAuthenticated, setSelectedAlbumId, setSelectedArtistName, setSelectedPlaylistId]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    if (playlistsData.length === 0) {
      if (selectedPlaylistId !== null) {
        setSelectedPlaylistId(null);
      }
      return;
    }

    if (!selectedPlaylistId || !playlistsData.some((playlist) => playlist.id === selectedPlaylistId)) {
      setSelectedPlaylistId(playlistsData[0]?.id ?? null);
    }
  }, [isAuthenticated, playlistsData, selectedPlaylistId]);

  useEffect(() => {
    if (!isAuthenticated || !sessionKey || !isPlaying || !currentTrack) {
      return;
    }

    recordRecentPlay(sessionKey, currentTrack);
  }, [currentTrack, currentTrackId, isAuthenticated, isPlaying, recordRecentPlay, sessionKey]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    if (selectedAlbumId || albumCards.length === 0) {
      return;
    }

    setSelectedAlbumId(albumCards[0]?.id ?? null);
  }, [albumCards, isAuthenticated, selectedAlbumId, setSelectedAlbumId]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    if (!selectedAlbumId || albumCards.some((album) => album.id === selectedAlbumId)) {
      return;
    }

    setSelectedAlbumId(albumCards[0]?.id ?? null);
  }, [albumCards, isAuthenticated, selectedAlbumId, setSelectedAlbumId]);

  const selectedAlbum = useMemo(
    () => albumCards.find((album) => album.id === selectedAlbumId) ?? null,
    [albumCards, selectedAlbumId],
  );

  const selectedCoverUrl =
    selectedAlbum?.coverArt && client
      ? client.getCoverArtUrl(selectedAlbum.coverArt, 512)
      : null;
  const selectedPlaylist = useMemo(
    () => playlistsData.find((playlist) => playlist.id === selectedPlaylistId) ?? null,
    [playlistsData, selectedPlaylistId],
  );
  const selectedPlaylistName = playlistDetailData?.name ?? selectedPlaylist?.name ?? "";
  const selectedPlaylistCoverArt = playlistDetailData?.coverArt ?? selectedPlaylist?.coverArt;
  const selectedPlaylistCoverUrl =
    selectedPlaylistCoverArt && client
      ? client.getCoverArtUrl(selectedPlaylistCoverArt, 512)
      : null;
  const selectedPlaylistSongs = playlistDetailData?.entry ?? [];
  const selectedPlaylistQueue = useMemo(
    () => (client ? selectedPlaylistSongs.map((song) => mapSongToTrackInfo(song, client)) : []),
    [client, selectedPlaylistSongs],
  );
  const selectedPlaylistSongCount = playlistDetailData?.songCount ??
    selectedPlaylist?.songCount ??
    selectedPlaylistSongs.length;
  const selectedPlaylistDurationSeconds = playlistDetailData?.duration ??
    selectedPlaylist?.duration ??
    selectedPlaylistSongs.reduce((total, song) => total + (song.duration ?? 0), 0);
  const selectedPlaylistOwner = playlistDetailData?.owner ?? selectedPlaylist?.owner;
  const selectedPlaylistComment = playlistDetailData?.comment ?? selectedPlaylist?.comment;
  const selectedPlaylistUpdatedAtLabel = formatDateTime(
    playlistDetailData?.changed ??
      selectedPlaylist?.changed ??
      playlistDetailData?.created ??
      selectedPlaylist?.created,
  );
  const playlistCards = useMemo(
    () =>
      [...playlistsData].sort((a, b) => {
        const aTimestamp = Date.parse(a.changed ?? a.created ?? "");
        const bTimestamp = Date.parse(b.changed ?? b.created ?? "");
        const aValid = Number.isFinite(aTimestamp);
        const bValid = Number.isFinite(bTimestamp);

        if (aValid && bValid && aTimestamp !== bTimestamp) {
          return bTimestamp - aTimestamp;
        }
        if (aValid && !bValid) {
          return -1;
        }
        if (!aValid && bValid) {
          return 1;
        }

        return a.name.localeCompare(b.name);
      }),
    [playlistsData],
  );
  const globalSearchAlbums = globalSearchData.albums;
  const globalSearchSongs = globalSearchData.songs;
  const suggestionAlbums = suggestionSearchData.albums;
  const suggestionSongs = suggestionSearchData.songs;
  const normalizedSelectedArtistKeyword = normalizedSelectedArtistName.toLowerCase();
  const artistDetailAlbums = useMemo(() => {
    if (!normalizedSelectedArtistName) {
      return [];
    }

    const exactMatches = artistDetailSearchData.albums.filter(
      (album) => album.artist?.trim().toLowerCase() === normalizedSelectedArtistKeyword,
    );
    const fuzzyMatches = artistDetailSearchData.albums.filter((album) =>
      album.artist?.trim().toLowerCase().includes(normalizedSelectedArtistKeyword),
    );
    const base = exactMatches.length > 0
      ? exactMatches
      : fuzzyMatches.length > 0
        ? fuzzyMatches
        : artistDetailSearchData.albums;
    const uniqueById = new Map<string, (typeof base)[number]>();

    for (const album of base) {
      if (!uniqueById.has(album.id)) {
        uniqueById.set(album.id, album);
      }
    }

    return Array.from(uniqueById.values()).sort(
      (a, b) => (b.songCount ?? 0) - (a.songCount ?? 0),
    );
  }, [artistDetailSearchData.albums, normalizedSelectedArtistKeyword, normalizedSelectedArtistName]);
  const artistDetailSongs = useMemo(() => {
    if (!normalizedSelectedArtistName) {
      return [];
    }

    const exactMatches = artistDetailSearchData.songs.filter(
      (song) => song.artist?.trim().toLowerCase() === normalizedSelectedArtistKeyword,
    );
    const fuzzyMatches = artistDetailSearchData.songs.filter((song) =>
      song.artist?.trim().toLowerCase().includes(normalizedSelectedArtistKeyword),
    );
    const base = exactMatches.length > 0
      ? exactMatches
      : fuzzyMatches.length > 0
        ? fuzzyMatches
        : artistDetailSearchData.songs;
    const uniqueById = new Map<string, (typeof base)[number]>();

    for (const song of base) {
      if (!uniqueById.has(song.id)) {
        uniqueById.set(song.id, song);
      }
    }

    return Array.from(uniqueById.values());
  }, [artistDetailSearchData.songs, normalizedSelectedArtistKeyword, normalizedSelectedArtistName]);
  const searchTopArtist = useMemo(() => {
    if (!normalizedSearchKeyword) {
      return null;
    }

    const keyword = normalizedSearchKeyword.toLowerCase();
    const artistMap = new Map<
      string,
      {
        artist: string;
        albumIds: Set<string>;
        songCount: number;
        coverArt?: string;
        score: number;
        sourceWeight: number;
      }
    >();

    const ensureArtist = (name?: string) => {
      const normalizedName = name?.trim();
      if (!normalizedName) {
        return null;
      }

      const key = normalizedName.toLowerCase();
      const current = artistMap.get(key);
      if (current) {
        return current;
      }

      const next = {
        artist: normalizedName,
        albumIds: new Set<string>(),
        songCount: 0,
        coverArt: undefined as string | undefined,
        score: 0,
        sourceWeight: 0,
      };
      artistMap.set(key, next);
      return next;
    };

    for (const album of globalSearchAlbums) {
      const artistEntry = ensureArtist(album.artist);
      if (!artistEntry) {
        continue;
      }

      const lowerArtist = artistEntry.artist.toLowerCase();
      artistEntry.albumIds.add(album.id);
      artistEntry.songCount += album.songCount ?? 0;
      artistEntry.sourceWeight += 2;
      if (!artistEntry.coverArt && album.coverArt) {
        artistEntry.coverArt = album.coverArt;
      }

      if (lowerArtist === keyword) {
        artistEntry.score += 6;
      } else if (lowerArtist.includes(keyword)) {
        artistEntry.score += 3;
      }

      if (album.name.toLowerCase().includes(keyword)) {
        artistEntry.score += 1;
      }
    }

    for (const song of globalSearchSongs) {
      const artistEntry = ensureArtist(song.artist);
      if (!artistEntry) {
        continue;
      }

      const lowerArtist = artistEntry.artist.toLowerCase();
      artistEntry.songCount += 1;
      artistEntry.sourceWeight += 1;
      if (song.albumId) {
        artistEntry.albumIds.add(song.albumId);
      }
      if (!artistEntry.coverArt && song.coverArt) {
        artistEntry.coverArt = song.coverArt;
      }

      if (lowerArtist === keyword) {
        artistEntry.score += 4;
      } else if (lowerArtist.includes(keyword)) {
        artistEntry.score += 2;
      }

      if (song.title.toLowerCase().includes(keyword)) {
        artistEntry.score += 1;
      }
    }

    return Array.from(artistMap.values())
      .map((artist) => ({
        artist: artist.artist,
        albumCount: artist.albumIds.size,
        songCount: artist.songCount,
        coverArt: artist.coverArt,
        score: artist.score,
        sourceWeight: artist.sourceWeight,
      }))
      .sort((a, b) => {
        const scoreGap = b.score - a.score;
        if (scoreGap !== 0) {
          return scoreGap;
        }

        const songGap = b.songCount - a.songCount;
        if (songGap !== 0) {
          return songGap;
        }

        const albumGap = b.albumCount - a.albumCount;
        if (albumGap !== 0) {
          return albumGap;
        }

        const sourceGap = b.sourceWeight - a.sourceWeight;
        if (sourceGap !== 0) {
          return sourceGap;
        }

        return a.artist.localeCompare(b.artist);
      })[0] ?? null;
  }, [globalSearchAlbums, globalSearchSongs, normalizedSearchKeyword]);
  const searchSuggestions = useMemo(() => {
    const keyword = normalizedDebouncedSearchInput.toLowerCase();
    if (!keyword) {
      return [];
    }

    const candidates = new Set<string>();
    const collect = (value?: string) => {
      const normalized = value?.trim();
      if (!normalized) {
        return;
      }

      if (!normalized.toLowerCase().includes(keyword)) {
        return;
      }

      candidates.add(normalized);
    };

    for (const album of albumCards) {
      collect(album.title);
      collect(album.artist);
    }

    for (const song of visibleSongs) {
      collect(song.title);
      collect(song.artist);
      collect(song.album);
    }

    for (const album of suggestionAlbums) {
      collect(album.name);
      collect(album.artist);
    }

    for (const song of suggestionSongs) {
      collect(song.title);
      collect(song.artist);
      collect(song.album);
    }

    return Array.from(candidates).slice(0, 8);
  }, [albumCards, normalizedSearchInput, suggestionAlbums, suggestionSongs, visibleSongs]);

  const getAlbumCoverUrl = (coverArt: string | undefined, size: number) =>
    coverArt && client ? client.getCoverArtUrl(coverArt, size) : null;
  const artistDetailCoverArt = artistDetailAlbums.find((album) => album.coverArt)?.coverArt ??
    artistDetailSongs.find((song) => song.coverArt)?.coverArt;
  const artistDetailCoverUrl = getAlbumCoverUrl(artistDetailCoverArt, 320);
  const artistDetailImageUrl = artistInfoData?.largeImageUrl ||
    artistInfoData?.mediumImageUrl ||
    artistInfoData?.smallImageUrl ||
    artistDetailCoverUrl;
  const shouldShowArtistImage = Boolean(artistDetailImageUrl) && !artistImageLoadFailed;
  const artistDetailArtistInitials = normalizedSelectedArtistName
    ? getArtistInitials(normalizedSelectedArtistName)
    : "";
  const searchTopArtistCoverUrl = searchTopArtist?.coverArt
    ? getAlbumCoverUrl(searchTopArtist.coverArt, 320)
    : null;
  const searchTopArtistInitials = searchTopArtist ? getArtistInitials(searchTopArtist.artist) : "";

  const getAlbumSecondaryMeta = (album: AlbumCard) =>
    [album.songCount ? `${album.songCount} 首` : null, album.year ? `${album.year}` : null]
      .filter(Boolean)
      .join(" · ");

  const selectedAlbumSongCount = selectedAlbum?.songCount ?? visibleSongs.length;
  const selectedAlbumDurationSeconds = selectedAlbum?.duration ??
    visibleSongs.reduce((total, song) => total + (song.duration ?? 0), 0);
  const selectedAlbumGenre = selectedAlbum?.genre ??
    visibleSongs.find((song) => song.genre?.trim())?.genre;
  const selectedAlbumQueue = useMemo(
    () => (client ? visibleSongs.map((song) => mapSongToTrackInfo(song, client)) : []),
    [client, visibleSongs],
  );
  const artistDetailSongDurationSeconds = useMemo(
    () => artistDetailSongs.reduce((total, song) => total + (song.duration ?? 0), 0),
    [artistDetailSongs],
  );
  const artistGenreTags = useMemo(() => {
    const genreCounts = new Map<string, number>();
    for (const album of artistDetailAlbums) {
      const genre = album.genre?.trim();
      if (genre) genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
    }
    for (const song of artistDetailSongs) {
      const genre = song.genre?.trim();
      if (genre) genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
    }
    return Array.from(genreCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);
  }, [artistDetailAlbums, artistDetailSongs]);
  const artistYearRange = useMemo(() => {
    const years = artistDetailAlbums
      .map((a) => a.year)
      .filter((y): y is number => typeof y === "number" && y > 0);
    if (years.length === 0) return null;
    const min = Math.min(...years);
    const max = Math.max(...years);
    return min === max ? `${min}` : `${min} – ${max}`;
  }, [artistDetailAlbums]);
  const artistBiography = useMemo(() => {
    const raw = artistInfoData?.biography;
    if (!raw) return "";
    return raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }, [artistInfoData?.biography]);

  useEffect(() => {
    setBioExpanded(false);
  }, [normalizedSelectedArtistName]);

  useEffect(() => {
    setArtistImageLoadFailed(false);
  }, [artistDetailImageUrl]);
  const albumFormatInfo = useMemo(() => {
    if (visibleSongs.length === 0) return null;
    const formats = new Map<string, number>();
    let totalBitrate = 0;
    let bitrateCount = 0;
    for (const song of visibleSongs) {
      if (song.suffix) {
        const upper = song.suffix.toUpperCase();
        formats.set(upper, (formats.get(upper) ?? 0) + 1);
      }
      if (song.bitRate) {
        totalBitrate += song.bitRate;
        bitrateCount++;
      }
    }
    const topFormat = Array.from(formats.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
    const avgBitrate = bitrateCount > 0 ? Math.round(totalBitrate / bitrateCount) : null;
    const parts: string[] = [];
    if (topFormat) parts.push(topFormat);
    if (avgBitrate) parts.push(`${avgBitrate} kbps`);
    return parts.length > 0 ? parts.join(" · ") : null;
  }, [visibleSongs]);

  const handlePlaySong = useCallback((songId: string) => {
    if (!client) {
      return;
    }

    const queue = visibleSongs.map((song) => mapSongToTrackInfo(song, client));
    const startIndex = queue.findIndex((song) => song.id === songId);

    if (startIndex < 0) {
      return;
    }

    setQueue(queue, startIndex);
    setPlaying(true);
  }, [client, visibleSongs, setQueue, setPlaying]);

  const handlePlayAlbumAll = useCallback(() => {
    if (selectedAlbumQueue.length === 0) {
      return;
    }

    setQueue(selectedAlbumQueue, 0);
    setPlaying(true);
  }, [selectedAlbumQueue, setQueue, setPlaying]);

  const handleShuffleAlbum = useCallback(() => {
    if (selectedAlbumQueue.length === 0) {
      return;
    }

    const shuffledQueue = shuffleArray(selectedAlbumQueue);
    setQueue(shuffledQueue, 0);
    setPlaying(true);
  }, [selectedAlbumQueue, setQueue, setPlaying]);

  const handlePlayGlobalSearchSong = useCallback((songId: string) => {
    if (!client || globalSearchSongs.length === 0) {
      return;
    }

    const queue = globalSearchSongs.map((song) => mapSongToTrackInfo(song, client));
    const startIndex = queue.findIndex((song) => song.id === songId);

    if (startIndex < 0) {
      return;
    }

    setQueue(queue, startIndex);
    setPlaying(true);
  }, [client, globalSearchSongs, setQueue, setPlaying]);
  const handlePlayArtistDetailSong = useCallback((songId: string) => {
    if (!client || artistDetailSongs.length === 0) {
      return;
    }

    const queue = artistDetailSongs.map((song) => mapSongToTrackInfo(song, client));
    const startIndex = queue.findIndex((song) => song.id === songId);
    if (startIndex < 0) {
      return;
    }

    setQueue(queue, startIndex);
    setPlaying(true);
  }, [artistDetailSongs, client, setQueue, setPlaying]);
  const handlePlayLovedTrack = useCallback((songId: string) => {
    if (!client || lovedTracksData.length === 0) {
      return;
    }

    const queue = lovedTracksData.map((song) => mapSongToTrackInfo(song, client));
    const startIndex = queue.findIndex((song) => song.id === songId);
    if (startIndex < 0) {
      return;
    }

    setQueue(queue, startIndex);
    setPlaying(true);
  }, [client, lovedTracksData, setQueue, setPlaying]);
  const handlePlayPlaylistSong = useCallback((songId: string) => {
    if (selectedPlaylistQueue.length === 0) {
      return;
    }

    const startIndex = selectedPlaylistQueue.findIndex((song) => song.id === songId);
    if (startIndex < 0) {
      return;
    }

    setQueue(selectedPlaylistQueue, startIndex);
    setPlaying(true);
  }, [selectedPlaylistQueue, setQueue, setPlaying]);
  const handlePlayPlaylistAll = useCallback(() => {
    if (selectedPlaylistQueue.length === 0) {
      return;
    }

    setQueue(selectedPlaylistQueue, 0);
    setPlaying(true);
  }, [selectedPlaylistQueue, setQueue, setPlaying]);
  const handleShufflePlaylist = useCallback(() => {
    if (selectedPlaylistQueue.length === 0) {
      return;
    }

    const shuffledQueue = shuffleArray(selectedPlaylistQueue);
    setQueue(shuffledQueue, 0);
    setPlaying(true);
  }, [selectedPlaylistQueue, setQueue, setPlaying]);

  const albumColumns = useMemo(() => getAlbumColumns(viewportWidth), [viewportWidth]);
  const albumGridAlbums = useMemo(
    () => {
      if (activeNavSection === "recent-added") {
        return recentPlayedAlbums;
      }

      if (activeNavSection === "for-you") {
        return forYouExploreAlbums;
      }

      return filteredAlbums;
    },
    [activeNavSection, filteredAlbums, forYouExploreAlbums, recentPlayedAlbums],
  );

  const albumPageSize = useMemo(
    () => Math.max(8, albumColumns * ALBUM_ROWS_PER_PAGE),
    [albumColumns],
  );
  const [albumPageIndex, setAlbumPageIndex] = useState(0);
  const albumPageCount = useMemo(
    () => Math.max(1, Math.ceil(albumGridAlbums.length / albumPageSize)),
    [albumGridAlbums.length, albumPageSize],
  );
  const currentAlbumPageIndex = Math.min(albumPageIndex, Math.max(0, albumPageCount - 1));
  const albumPageStart = currentAlbumPageIndex * albumPageSize;
  const displayedAlbums = useMemo(
    () => albumGridAlbums.slice(albumPageStart, albumPageStart + albumPageSize),
    [albumGridAlbums, albumPageStart, albumPageSize],
  );

  useEffect(() => {
    if (albumPageIndex === currentAlbumPageIndex) {
      return;
    }

    setAlbumPageIndex(currentAlbumPageIndex);
  }, [albumPageIndex, currentAlbumPageIndex]);

  useEffect(() => {
    if (
      activeNavSection !== "albums" &&
      activeNavSection !== "recent-added" &&
      activeNavSection !== "for-you" &&
      activeNavSection !== "discover"
    ) {
      return;
    }

    setAlbumPageIndex(0);
  }, [activeNavSection, normalizedSearchKeyword, albumPageSize]);

  useEffect(() => {
    if (!isAuthenticated || !client) {
      return;
    }

    if (!hasMoreAlbumPages || albumLoadingMore) {
      return;
    }

    const timer = window.setTimeout(() => {
      void fetchNextAlbumPage();
    }, 80);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    isAuthenticated,
    client,
    hasMoreAlbumPages,
    albumLoadingMore,
    fetchNextAlbumPage,
  ]);

  const handlePreviousAlbumPage = useCallback(() => {
    setAlbumPageIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const handleNextAlbumPage = useCallback(() => {
    setAlbumPageIndex((prev) => Math.min(albumPageCount - 1, prev + 1));
  }, [albumPageCount]);

  const handlePreviousSongPage = useCallback(() => {
    setSongPageIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const handleNextSongPage = useCallback(() => {
    setSongPageIndex((prev) => Math.min(songPageCount - 1, prev + 1));
  }, [songPageCount]);

  const lyricsTarget = currentTrack
    ? {
        songId: currentTrack.id,
        title: currentTrack.title,
        artist: currentTrack.artist,
      }
    : null;

  const {
    data: lyricsData = {
      text: "",
      timedLines: [],
    },
    isLoading: lyricsLoading,
  } = useLyrics(client, sessionKey, lyricsTarget);
  const nowPlayingHighResCoverUrl =
    currentTrack?.coverArtId && client
      ? client.getCoverArtUrl(currentTrack.coverArtId, 1000)
      : null;
  const accentFromCover = useDominantColor(currentTrack?.coverUrl ?? selectedCoverUrl ?? null);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const sourceColor = accentSource === "album" ? accentFromCover : accentColor;
    const rgb = parseColorToRgb(sourceColor);
    const root = document.documentElement;
    root.style.setProperty("--accent-rgb", `${rgb.r} ${rgb.g} ${rgb.b}`);
    root.style.setProperty("--accent-solid", `rgb(${rgb.r} ${rgb.g} ${rgb.b})`);
    root.style.setProperty("--accent-soft", `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.16)`);
    root.style.setProperty("--accent-soft-strong", `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.28)`);
    root.style.setProperty("--accent-border", `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.42)`);
    root.style.setProperty("--accent-text", `rgb(${Math.max(10, rgb.r - 20)} ${Math.max(50, rgb.g - 20)} ${Math.max(50, rgb.b - 20)})`);
  }, [accentColor, accentFromCover, accentSource]);

  useScrobbling(currentTrack);

  const viewTitleMap = {
    "for-you": "为你推荐",
    discover: "发现",
    "recent-added": "最近播放",
    albums: "专辑",
    artists: "艺人",
    songs: "歌曲",
    "loved-tracks": "我喜欢的音乐",
    genres: "流派",
    folders: "文件夹",
    "album-detail": "专辑详情",
    "playlist-detail": "歌单详情",
    "artist-detail": "艺人详情",
    search: "全局搜索",
    playlists: "播放列表",
  } as const;

  const viewDescriptionMap = {
    "for-you": "聚合推荐位与快捷入口，优先展示你最可能继续听的内容。",
    discover: "基于流派聚合推荐并过滤首页已展示内容，专注探索不重复的专辑。",
    "recent-added": "按真实播放历史展示最近听过的专辑，便于快速回听。",
    albums: "专辑列表已接入分页与持续拉取，适合大音乐库浏览。",
    artists: "按专辑统计艺人，展示曲目规模与最近发行年份。",
    songs: "展示库里的所有歌曲，支持分页查看、双击播放与打乱播放。",
    "loved-tracks": "来自服务器收藏/喜欢列表，可直接连续播放。",
    genres: "按音乐风格聚合，快速切到你想听的类型。",
    folders: "显示服务器音乐目录，便于按底层文件结构浏览。",
    "album-detail": "展示专辑元数据并支持播放全部、打乱播放。",
    "playlist-detail": "展示歌单元数据与完整歌曲列表，支持连续播放。",
    "artist-detail": "展示艺人聚合结果，支持查看专辑与按艺人播放歌曲。",
    search: "跨全库搜索专辑与歌曲，结果来自 Subsonic search3。",
    playlists: "展示服务器歌单并支持整单播放、打乱与单曲点播。",
  } as const;

  const isPlaylistsView = activeNavSection === "playlists";
  const isPlaylistDetailView = activeNavSection === "playlist-detail";
  const isSearchView = activeNavSection === "search";
  const isAlbumDetailView = activeNavSection === "album-detail";
  const isArtistDetailView = activeNavSection === "artist-detail";
  const isForYouView = activeNavSection === "for-you";
  const isDiscoverView = activeNavSection === "discover";
  const isRecentAddedView = activeNavSection === "recent-added";
  const isAlbumsView = activeNavSection === "albums";
  const isArtistsView = activeNavSection === "artists";
  const isSongsView = activeNavSection === "songs";
  const isLovedTracksView = activeNavSection === "loved-tracks";
  const isGenresView = activeNavSection === "genres";
  const isFoldersView = activeNavSection === "folders";
  const isAlbumCollectionView = isForYouView || isRecentAddedView || isAlbumsView;
  const discoverFeaturedAlbum = discoverRecommendedAlbums[0] ?? discoverCollectionAlbums[0] ?? null;
  const discoverFeaturedCoverUrl = discoverFeaturedAlbum
    ? getAlbumCoverUrl(discoverFeaturedAlbum.coverArt, 512)
    : null;
  const discoverFeaturedMeta = discoverFeaturedAlbum
    ? getAlbumSecondaryMeta(discoverFeaturedAlbum)
    : "";
  const isLibraryView = !isPlaylistsView && !isSearchView;
  const currentViewTitle = isArtistDetailView && normalizedSelectedArtistName
    ? `艺人详情 · ${normalizedSelectedArtistName}`
    : isPlaylistDetailView && selectedPlaylistName
      ? `歌单详情 · ${selectedPlaylistName}`
      : viewTitleMap[activeNavSection];
  const currentViewDescription = isArtistDetailView && normalizedSelectedArtistName
    ? `聚合 ${normalizedSelectedArtistName} 的专辑和歌曲结果，可直接播放与打开专辑详情。`
    : isPlaylistDetailView && selectedPlaylistName
      ? `展示歌单「${selectedPlaylistName}」的完整歌曲列表，可直接播放与跳转专辑。`
      : viewDescriptionMap[activeNavSection];
  const canGoBack = navHistory.index > 0;
  const canGoForward = navHistory.index < navHistory.stack.length - 1;
  const prefersReducedMotion = useReducedMotion();
  const pageTransitionKey = useMemo(() => {
    if (activeNavSection === "album-detail") {
      return `album-detail:${selectedAlbumId ?? "none"}`;
    }

    if (activeNavSection === "playlist-detail") {
      return `playlist-detail:${selectedPlaylistId ?? "none"}`;
    }

    if (activeNavSection === "artist-detail") {
      return `artist-detail:${normalizedSelectedArtistName || "none"}`;
    }

    if (activeNavSection === "search") {
      return "search";
    }

    return activeNavSection;
  }, [
    activeNavSection,
    normalizedSelectedArtistName,
    selectedAlbumId,
    selectedPlaylistId,
  ]);

  const handleNavigateSection = (section: LibraryNavSection) => {
    if (section !== "search" && searchKeyword.trim()) {
      setSearchKeyword("");
      setSearchInput("");
    }

    if (section === activeNavSection) {
      return;
    }

    setActiveNavSection(section);
    setSettingsPanelOpen(false);
    setNavHistory((prev) => {
      const currentSection = prev.stack[prev.index];
      if (currentSection === section) {
        return prev;
      }

      const nextStack = [...prev.stack.slice(0, prev.index + 1), section];
      return {
        stack: nextStack,
        index: nextStack.length - 1,
      };
    });
  };

  const handleGoBack = () => {
    setNavHistory((prev) => {
      if (prev.index <= 0) {
        return prev;
      }

      const nextIndex = prev.index - 1;
      const nextSection = prev.stack[nextIndex] ?? "for-you";
      if (nextSection !== "search" && searchKeyword.trim()) {
        setSearchKeyword("");
        setSearchInput("");
      }
      setActiveNavSection(nextSection);
      return {
        ...prev,
        index: nextIndex,
      };
    });
  };

  const handleGoForward = () => {
    setNavHistory((prev) => {
      if (prev.index >= prev.stack.length - 1) {
        return prev;
      }

      const nextIndex = prev.index + 1;
      const nextSection = prev.stack[nextIndex] ?? "for-you";
      if (nextSection !== "search" && searchKeyword.trim()) {
        setSearchKeyword("");
        setSearchInput("");
      }
      setActiveNavSection(nextSection);
      return {
        ...prev,
        index: nextIndex,
      };
    });
  };

  const handleOpenNowPlayingSheet = () => {
    if (!currentTrack) {
      return;
    }

    setNowPlayingSheetOpen(true);
  };

  goBackRef.current = handleGoBack;
  goForwardRef.current = handleGoForward;

  const handleToggleNowPlayingSheet = () => {
    if (!currentTrack) {
      return;
    }

    setNowPlayingSheetOpen((prev) => !prev);
  };

  const handleCloseNowPlayingSheet = () => {
    setNowPlayingSheetOpen(false);
  };

  const handleOpenSettingsPanel = () => {
    setSettingsPanelOpen(true);
  };

  const handleCloseSettingsPanel = () => {
    setSettingsPanelOpen(false);
  };

  const handleSelectQueueTrack = (trackId: string) => {
    playTrackById(trackId);
    setPlaying(true);
  };

  const handleSearchKeywordChange = (keyword: string) => {
    setSearchInput(keyword);
  };

  const handleSearchSubmit = (keyword: string) => {
    const normalized = keyword.trim();
    setSearchInput(keyword);

    if (!normalized) {
      setSearchKeyword("");
      if (activeNavSection === "search") {
        handleNavigateSection("for-you");
      }
      return;
    }

    setSearchKeyword(normalized);
    if (activeNavSection !== "search") {
      handleNavigateSection("search");
    }
  };

  const handleOpenAlbumDetail = useCallback((albumId: string) => {
    setSelectedAlbumId(albumId);
    handleNavigateSection("album-detail");
  }, [setSelectedAlbumId, handleNavigateSection]);
  const handleOpenPlaylistDetail = useCallback((playlistId: string) => {
    setSelectedPlaylistId(playlistId);
    handleNavigateSection("playlist-detail");
  }, [setSelectedPlaylistId, handleNavigateSection]);
  const handleOpenArtistDetail = useCallback((artistName: string) => {
    const normalized = artistName.trim();
    if (!normalized) {
      return;
    }

    setNowPlayingSheetOpen(false);
    setSelectedArtistName(normalized);
    handleNavigateSection("artist-detail");
  }, [handleNavigateSection, setNowPlayingSheetOpen]);

  const handleBackToAlbums = () => {
    handleNavigateSection("albums");
  };

  const handleBackToPlaylists = () => {
    handleNavigateSection("playlists");
  };

  const handleBackToArtists = () => {
    handleNavigateSection("artists");
  };

  const handleRefreshLibrary = async () => {
    if (isRefreshingLibrary) {
      return;
    }

    setRefreshingLibrary(true);
    try {
      await queryClient.cancelQueries({ queryKey: ["library"] });
      queryClient.removeQueries({ queryKey: ["library"] });
      await queryClient.refetchQueries({
        queryKey: ["library"],
        type: "active",
      });
    } finally {
      setRefreshingLibrary(false);
    }
  };

  useEffect(() => {
    if (!isNowPlayingSheetOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      setNowPlayingSheetOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isNowPlayingSheetOpen]);

  useEffect(() => {
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 3) {
        event.preventDefault();
        goBackRef.current();
      } else if (event.button === 4) {
        event.preventDefault();
        goForwardRef.current();
      }
    };

    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  if (isRestoringSession) {
    return (
      <div className="relative h-screen w-full overflow-hidden bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <div className="relative flex h-full w-full items-center justify-center overflow-hidden px-6">
          <WindowTitlebar />
          <div className="relative z-10 flex items-center gap-3 rounded-lg border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-200">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在恢复登录状态...
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="relative h-screen w-full overflow-hidden bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <div className="relative flex h-full w-full items-center justify-center overflow-hidden px-6">
          <WindowTitlebar />
          <div className="relative z-10 w-full max-w-md pt-16">
            <div className="mb-4 text-center">
              <h1 className="text-2xl font-semibold tracking-tight">OtoMusic</h1>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                登录后即可同步 Navidrome 的专辑与歌曲并开始播放。
              </p>
            </div>

            <LoginPanel
              initialValues={{
                baseUrl: session?.baseUrl ?? envDefaults.subsonicBaseUrl,
                username: session?.username ?? envDefaults.subsonicUsername,
                password: session?.password ?? envDefaults.subsonicPassword,
              }}
              isSubmitting={isLoggingIn}
              errorMessage={loginError}
              onSubmit={(values) => {
                clearLoginError();
                void login(values);
              }}
              onFieldChange={clearLoginError}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-full overflow-hidden bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="relative h-full w-full overflow-hidden">
        <WindowTitlebar
          isAuthenticated
          searchKeyword={searchInput}
          onSearchKeywordChange={handleSearchKeywordChange}
          onSearchSubmit={handleSearchSubmit}
          searchSuggestions={searchSuggestions}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onGoBack={handleGoBack}
          onGoForward={handleGoForward}
          onRefresh={() => {
            void handleRefreshLibrary();
          }}
          refreshing={isRefreshingLibrary}
        />

        <div className="relative z-10 flex h-full min-h-0 pb-40 pt-14 md:pb-24">
          <Sidebar
            onNavigateSection={handleNavigateSection}
            onOpenSettings={handleOpenSettingsPanel}
          />

          <main ref={mainRef} className="relative h-full min-h-0 flex-1 overflow-y-auto p-6 sm:p-8 scrollbar-thin">
            <div className="pb-12">
              <motion.div
                key={pageTransitionKey}
                className="flex flex-col gap-8"
                initial={prefersReducedMotion ? { opacity: 1, scale: 1 } : { opacity: 0.82, scale: 0.985 }}
                animate={{ opacity: 1, scale: 1 }}
                style={{ willChange: "opacity, transform" }}
                transition={
                  prefersReducedMotion
                    ? { duration: 0 }
                    : { duration: 0.14, ease: [0.16, 1, 0.3, 1] }
                }
              >
        <section className="flex items-center justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-slate-500 dark:text-slate-300">
              <Disc3 className="h-4 w-4" />
              <span className="text-xs tracking-[0.2em]">资料库</span>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight">{currentViewTitle}</h1>
              {updateChecker.hasUpdate === true && updateChecker.latestVersion ? (
                <a
                  href={updateChecker.releaseUrl ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent-text)] transition-colors hover:opacity-85"
                >
                  <Download className="h-3 w-3" />
                  v{updateChecker.latestVersion} 可更新
                </a>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {currentViewDescription}
            </p>
          </div>
        </section>

        {isLibraryView && (albumError || songsError) && (
          <Card className="border-rose-200 bg-rose-50 dark:border-rose-900/40 dark:bg-rose-900/20">
            <CardHeader>
              <CardTitle className="text-base">列表加载失败</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-700 dark:text-slate-200">
              {albumErrorObj instanceof Error
                ? albumErrorObj.message
                : songsErrorObj instanceof Error
                  ? songsErrorObj.message
                  : "Unknown error"}
            </CardContent>
          </Card>
        )}

        {isPlaylistsView && (
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <ListMusic className="h-4 w-4 text-slate-500" />
              <h2 className="text-sm font-medium">歌单列表</h2>
            </div>

            {playlistsError ? (
              <Card className="border-rose-200 bg-rose-50 dark:border-rose-900/40 dark:bg-rose-900/20">
                <CardContent className="pt-4 text-sm text-slate-700 dark:text-slate-200">
                  {playlistsErrorObj instanceof Error
                    ? playlistsErrorObj.message
                    : "歌单列表加载失败"}
                </CardContent>
              </Card>
            ) : playlistsLoading ? (
              <Card>
                <CardContent className="flex h-24 items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-300">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在加载歌单...
                </CardContent>
              </Card>
            ) : playlistCards.length === 0 ? (
              <Card>
                <CardContent className="pt-5 text-sm text-slate-600 dark:text-slate-300">
                  服务器暂无歌单，请先在 Navidrome/Subsonic 侧创建歌单。
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">全部歌单 ({playlistCards.length})</CardTitle>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    点击歌单进入详情页查看完整歌曲列表
                  </p>
                </CardHeader>
                <CardContent className="space-y-2 p-3 pt-0">
                  {playlistCards.map((playlist) => {
                    const playlistUpdatedLabel = formatDateTime(playlist.changed ?? playlist.created);
                    const playlistMeta = [
                      `${playlist.songCount ?? 0} 首歌曲`,
                      playlist.duration ? formatDuration(playlist.duration) : null,
                      playlist.owner?.trim() || null,
                      playlistUpdatedLabel ? `更新于 ${playlistUpdatedLabel}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ");

                    return (
                      <button
                        key={playlist.id}
                        type="button"
                        onClick={() => handleOpenPlaylistDetail(playlist.id)}
                        className={cn(
                          "w-full rounded-xl border px-3 py-3 text-left transition-colors",
                          "border-slate-200 bg-white hover:border-[var(--accent-border)] hover:bg-[var(--accent-soft)] dark:border-slate-800 dark:bg-slate-900 dark:hover:border-[var(--accent-border)]",
                          selectedPlaylistId === playlist.id &&
                            "border-[var(--accent-border)] bg-[var(--accent-soft)]",
                        )}
                      >
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                          {playlist.name}
                        </p>
                        {playlistMeta ? (
                          <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                            {playlistMeta}
                          </p>
                        ) : null}
                      </button>
                    );
                  })}
                </CardContent>
              </Card>
            )}
          </section>
        )}

        {isSearchView && (
          <section className="space-y-5">
            <div className="flex items-center gap-2">
              <Disc3 className="h-4 w-4 text-slate-500" />
              <h2 className="text-sm font-medium">
                搜索结果 · {normalizedSearchKeyword || "请输入关键词"}
              </h2>
            </div>

            {globalSearchError && (
              <Card className="border-rose-200 bg-rose-50 dark:border-rose-900/40 dark:bg-rose-900/20">
                <CardContent className="pt-4 text-sm text-slate-700 dark:text-slate-200">
                  {globalSearchErrorObj instanceof Error
                    ? globalSearchErrorObj.message
                    : "搜索失败"}
                </CardContent>
              </Card>
            )}

            <Card className="overflow-hidden border-[var(--accent-border)] bg-[linear-gradient(120deg,var(--accent-soft)_0%,rgba(59,130,246,0.1)_55%,rgba(15,23,42,0.03)_100%)] dark:border-[var(--accent-border)] dark:bg-[linear-gradient(120deg,rgba(6,78,59,0.34)_0%,rgba(15,23,42,0.72)_100%)]">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">最佳匹配艺人</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {globalSearchLoading ? (
                  <div className="flex h-24 items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-300">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    搜索中...
                  </div>
                ) : !normalizedSearchKeyword ? (
                  <div className="flex h-20 items-center text-sm text-slate-600 dark:text-slate-300">
                    输入关键词后展示艺人最佳匹配
                  </div>
                ) : searchTopArtist ? (
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-4">
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border border-white/80 bg-white/70 shadow-sm dark:border-slate-700 dark:bg-slate-900/60">
                        {searchTopArtistCoverUrl ? (
                          <img
                            src={searchTopArtistCoverUrl}
                            alt={`${searchTopArtist.artist} avatar`}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_30%_30%,var(--accent-soft-strong),transparent_45%),radial-gradient(circle_at_75%_75%,rgba(59,130,246,0.2),transparent_48%)] text-sm font-semibold tracking-wide text-[var(--accent-text)]">
                            {searchTopArtistInitials}
                          </div>
                        )}
                      </div>

                      <div className="min-w-0">
                        <p className="mb-1 inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-1 text-[0.68rem] font-medium uppercase tracking-[0.16em] text-[var(--accent-text)] dark:bg-slate-900/50">
                          Top Result
                        </p>
                        <p className="truncate text-xl font-semibold tracking-tight">
                          <button
                            type="button"
                            onClick={() => handleOpenArtistDetail(searchTopArtist.artist)}
                            className="transition-colors hover:text-[var(--accent-text)] hover:underline"
                          >
                            {searchTopArtist.artist}
                          </button>
                        </p>
                        <p className="mt-1 truncate text-sm text-slate-600 dark:text-slate-300">
                          {searchTopArtist.albumCount} 张匹配专辑 · {searchTopArtist.songCount} 首匹配歌曲
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <p className="text-xs tracking-wide text-slate-500 dark:text-slate-400">
                        结果来自当前搜索命中内容
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenArtistDetail(searchTopArtist.artist)}
                      >
                        查看艺人详情
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-20 items-center text-sm text-slate-600 dark:text-slate-300">
                    没有匹配到艺人
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="text-base">匹配专辑 ({globalSearchAlbums.length})</CardTitle>
                {globalSearchAlbums.length > 6 ? (
                  <span className="text-xs text-slate-500 dark:text-slate-400">左右滑动查看更多</span>
                ) : null}
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                {globalSearchLoading ? (
                  <div className="flex h-24 items-center justify-center gap-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    搜索中...
                  </div>
                ) : globalSearchAlbums.length > 0 ? (
                  <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 pr-1 scrollbar-thin">
                    {globalSearchAlbums.map((album) => {
                      const coverUrl =
                        album.coverArt && client
                          ? client.getCoverArtUrl(album.coverArt, 280)
                          : null;
                      const albumMeta = [
                        album.songCount ? `${album.songCount} 首` : null,
                        album.year ? `${album.year}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ");

                      return (
                        <div key={album.id} className="group w-[140px] shrink-0 snap-start text-left">
                          <button
                            type="button"
                            onClick={() => handleOpenAlbumDetail(album.id)}
                            className="block w-full text-left outline-none"
                          >
                            <div className="h-[140px] w-[140px] overflow-hidden rounded-xl border border-slate-200 bg-slate-100 transition-colors group-hover:border-[var(--accent-border)] dark:border-slate-800 dark:bg-slate-900/50">
                              {coverUrl ? (
                                <img
                                  src={coverUrl}
                                  alt={`${album.name} cover`}
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="h-full w-full bg-[radial-gradient(circle_at_20%_20%,rgba(16,185,129,0.24),transparent_40%),radial-gradient(circle_at_80%_80%,rgba(59,130,246,0.2),transparent_42%)]" />
                              )}
                            </div>
                            <div className="mt-2 min-w-0 px-0.5">
                              <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                {album.name}
                              </p>
                              {albumMeta ? (
                                <p className="mt-0.5 truncate text-[0.68rem] text-slate-400 dark:text-slate-500">
                                  {albumMeta}
                                </p>
                              ) : null}
                            </div>
                          </button>
                          {album.artist ? (
                            <button
                              type="button"
                              onClick={() => handleOpenArtistDetail(album.artist!)}
                              className="mt-0.5 block max-w-full truncate px-0.5 text-left text-xs text-slate-500 transition-colors hover:text-[var(--accent-text)] hover:underline dark:text-slate-400"
                            >
                              {album.artist}
                            </button>
                          ) : (
                            <p className="px-0.5 text-xs text-slate-500 dark:text-slate-400">
                              未知艺术家
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex h-24 items-center justify-center text-sm text-slate-500">
                    没有匹配到专辑
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">匹配歌曲 ({globalSearchSongs.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {globalSearchLoading ? (
                  <div className="flex h-24 items-center justify-center gap-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    搜索中...
                  </div>
                ) : globalSearchSongs.length > 0 ? (
                  <div className="overflow-x-auto pb-1 scrollbar-thin">
                    <div className="min-w-[760px] overflow-hidden rounded-b-xl border-y border-slate-200/90 dark:border-slate-800/90">
                      <div className="grid grid-cols-[44px_minmax(220px,2.3fr)_minmax(180px,1.45fr)_minmax(180px,1.55fr)_62px] items-center bg-slate-100/80 px-4 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:bg-slate-900/80 dark:text-slate-400">
                        <span>#</span>
                        <span>标题</span>
                        <span>艺人</span>
                        <span>专辑</span>
                        <span className="justify-self-end">时长</span>
                      </div>
                      <div className="divide-y divide-slate-200/70 dark:divide-slate-800/90">
                        {globalSearchSongs.map((song, index) => (
                          <div
                            key={song.id}
                            className={cn(
                              "group grid w-full grid-cols-[44px_minmax(220px,2.3fr)_minmax(180px,1.45fr)_minmax(180px,1.55fr)_62px] items-center px-4 py-2 text-left outline-none transition-colors duration-150",
                              "hover:bg-slate-100/90 dark:hover:bg-slate-800/60",
                              currentTrackId === song.id
                                ? "bg-[var(--accent-soft)] text-[var(--accent-text)]"
                                : "text-slate-700 dark:text-slate-200",
                            )}
                          >
                            <span className={cn(
                              "text-sm font-semibold tabular-nums text-slate-500 transition-colors group-hover:text-slate-700 dark:text-slate-400 dark:group-hover:text-slate-200",
                              currentTrackId === song.id && "text-[var(--accent-solid)]",
                            )}>
                              {index + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() => handlePlayGlobalSearchSong(song.id)}
                              className="truncate text-left text-sm font-medium transition-colors hover:text-[var(--accent-text)]"
                            >
                              {song.title}
                            </button>
                            <button
                              type="button"
                              onClick={() => { if (song.artist) handleOpenArtistDetail(song.artist); }}
                              disabled={!song.artist}
                              className="truncate text-left text-xs text-slate-500 transition-colors hover:text-[var(--accent-text)] hover:underline disabled:cursor-default disabled:hover:no-underline dark:text-slate-400"
                            >
                              {song.artist ?? "未知艺术家"}
                            </button>
                            {song.albumId ? (
                              <button
                                type="button"
                                onClick={() => handleOpenAlbumDetail(song.albumId!)}
                                className="truncate text-left text-xs text-slate-500 transition-colors hover:text-[var(--accent-text)] hover:underline dark:text-slate-400"
                              >
                                {song.album ?? "未知专辑"}
                              </button>
                            ) : (
                              <span className="truncate text-xs text-slate-500 dark:text-slate-400">
                                {song.album ?? "未知专辑"}
                              </span>
                            )}
                            <span className="justify-self-end text-[0.7rem] tabular-nums text-slate-500 dark:text-slate-400">
                              {formatTime(song.duration ?? 0)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-24 items-center justify-center text-sm text-slate-500">
                    没有匹配到歌曲
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        )}

        {isLibraryView && (
          <>
            {isAlbumCollectionView && !isAlbumDetailView && (
              <section className="space-y-5">
                {isForYouView && (
                  <>
                    <Card className="overflow-hidden border-[var(--accent-border)] bg-[linear-gradient(135deg,var(--accent-soft)_0%,rgba(59,130,246,0.1)_55%,rgba(15,23,42,0.03)_100%)] dark:border-[var(--accent-border)] dark:bg-[linear-gradient(135deg,rgba(5,46,22,0.55)_0%,rgba(17,24,39,0.45)_100%)]">
                      <CardContent className="p-5">
                        {discoverFeaturedAlbum ? (
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 items-center gap-4">
                              {discoverFeaturedCoverUrl ? (
                                <img
                                  src={discoverFeaturedCoverUrl}
                                  alt={`${discoverFeaturedAlbum.title} cover`}
                                  className="h-20 w-20 rounded-xl object-cover shadow-md"
                                />
                              ) : (
                                <div className="h-20 w-20 rounded-xl bg-[radial-gradient(circle_at_20%_20%,rgba(16,185,129,0.28),transparent_40%),radial-gradient(circle_at_80%_80%,rgba(59,130,246,0.24),transparent_42%)]" />
                              )}

                              <div className="min-w-0">
                                <p className="mb-2 inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-1 text-[0.68rem] font-medium uppercase tracking-[0.16em] text-[var(--accent-text)] dark:bg-slate-900/55">
                                  推荐位
                                </p>
                                <h3 className="truncate text-xl font-semibold tracking-tight">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenAlbumDetail(discoverFeaturedAlbum.id)}
                                    className="transition-colors hover:text-[var(--accent-text)] hover:underline"
                                  >
                                    {discoverFeaturedAlbum.title}
                                  </button>
                                </h3>
                                <p className="mt-1 truncate text-sm text-slate-600 dark:text-slate-300">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenArtistDetail(discoverFeaturedAlbum.artist)}
                                    className="transition-colors hover:text-[var(--accent-text)] hover:underline"
                                  >
                                    {discoverFeaturedAlbum.artist}
                                  </button>
                                  {discoverFeaturedMeta ? ` · ${discoverFeaturedMeta}` : ""}
                                </p>
                              </div>
                            </div>

                            <Button
                              onClick={() => handleOpenAlbumDetail(discoverFeaturedAlbum.id)}
                              className="shrink-0"
                            >
                              立即播放
                            </Button>
                          </div>
                        ) : (
                          <div className="flex h-24 items-center justify-center text-sm text-slate-600 dark:text-slate-300">
                            暂无推荐专辑
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    <div className="grid gap-4 xl:grid-cols-2">
                      {[
                        {
                          key: "recommended",
                          icon: Music2,
                          title: "智能推荐",
                          description: "混合曲目规模、时长和每日轮换，让推荐不只停留在最近新增。",
                          albums: discoverRecommendedAlbums,
                        },
                        {
                          key: "collection",
                          icon: Disc3,
                          title: "收藏曲目较多",
                          description: "优先展示曲目数更丰富的专辑，适合连续播放。",
                          albums: discoverCollectionAlbums,
                        },
                      ].map((section) => (
                        <Card key={section.key}>
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                              <section.icon className="h-4 w-4 text-slate-500" />
                              {section.title}
                            </CardTitle>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{section.description}</p>
                          </CardHeader>
                          <CardContent className="p-3 pt-0">
                            {section.albums.length > 0 ? (
                              <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
                                {section.albums.map((album) => {
                                  const coverUrl = getAlbumCoverUrl(album.coverArt, 384);
                                  const albumMeta = getAlbumSecondaryMeta(album);

                                  return (
                                    <div
                                      key={`${section.key}-${album.id}`}
                                      className="w-40 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white text-left transition-colors hover:border-[var(--accent-border)] dark:border-slate-800 dark:bg-slate-900"
                                    >
                                      <button
                                        type="button"
                                        onClick={() => handleOpenAlbumDetail(album.id)}
                                        className="block w-full text-left"
                                      >
                                        <div className="aspect-square overflow-hidden border-b border-slate-200 dark:border-slate-800">
                                          {coverUrl ? (
                                            <img
                                              src={coverUrl}
                                              alt={`${album.title} cover`}
                                              className="h-full w-full object-cover"
                                              loading="lazy"
                                            />
                                          ) : (
                                            <div className="h-full w-full bg-[radial-gradient(circle_at_20%_20%,rgba(16,185,129,0.24),transparent_40%),radial-gradient(circle_at_80%_80%,rgba(59,130,246,0.2),transparent_42%)]" />
                                          )}
                                        </div>
                                        <div className="px-3 pt-3">
                                          <p className="truncate text-sm font-medium">{album.title}</p>
                                          {albumMeta ? (
                                            <p className="mt-1 truncate text-[0.68rem] text-slate-500 dark:text-slate-400">
                                              {albumMeta}
                                            </p>
                                          ) : null}
                                        </div>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleOpenArtistDetail(album.artist)}
                                        className="mb-3 block max-w-full truncate px-3 text-left text-xs text-slate-500 transition-colors hover:text-[var(--accent-text)] hover:underline dark:text-slate-400"
                                      >
                                        {album.artist}
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="flex h-20 items-center justify-center rounded-lg text-sm text-slate-500">
                                暂无可展示内容
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </>
                )}

                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <Disc3 className="h-4 w-4 text-slate-500" />
                    <h2 className="text-sm font-medium">
                      {isForYouView
                        ? "推荐后继续探索"
                        : isRecentAddedView
                            ? "最近播放专辑"
                            : "专辑列表"}
                    </h2>
                  </div>

                  <Card>
                    <CardContent className="p-3">
                      {albumLoading ? (
                        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
                          {Array.from({ length: 6 }).map((_, index) => (
                            <div
                              key={`album-skeleton-${index}`}
                              className="h-[220px] animate-pulse rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800"
                            />
                          ))}
                        </div>
                      ) : albumGridAlbums.length > 0 ? (
                        <div className="pr-1">
                          <div
                            className="grid gap-4"
                            style={{
                              gridTemplateColumns: `repeat(${albumColumns}, minmax(0, 1fr))`,
                            }}
                          >
                            {displayedAlbums.map((album) => {
                              const coverUrl = getAlbumCoverUrl(album.coverArt, 384);

                              return (
                                <AlbumGridItem
                                  key={album.id}
                                  id={album.id}
                                  title={album.title}
                                  artist={album.artist}
                                  coverUrl={coverUrl}
                                  onClick={handleOpenAlbumDetail}
                                  onArtistClick={handleOpenArtistDetail}
                                />
                              );
                            })}
                          </div>

                          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 pt-3 text-xs text-slate-500 dark:border-slate-800/80 dark:text-slate-400">
                            <p>
                              第 {currentAlbumPageIndex + 1} / {albumPageCount} 页 · 共 {albumGridAlbums.length} 张专辑
                              {hasMoreAlbumPages || albumLoadingMore ? " · 正在加载更多..." : ""}
                            </p>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handlePreviousAlbumPage}
                                disabled={currentAlbumPageIndex === 0}
                              >
                                上一页
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handleNextAlbumPage}
                                disabled={currentAlbumPageIndex >= albumPageCount - 1}
                              >
                                下一页
                              </Button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex h-24 items-center justify-center rounded-lg text-sm text-slate-500">
                          {isRecentAddedView ? "暂无最近播放，先播放几首歌后这里会出现记录" : "没有匹配到专辑"}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </section>
            )}

            {isDiscoverView && !isAlbumDetailView && (
              <section className="space-y-5">
                {discoverGenreSections.length > 0 ? (
                  <div className="space-y-4">
                    {discoverGenreSections.map((section) => (
                      <Card key={`discover-genre-${section.key}`}>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2 text-base">
                            <Tags className="h-4 w-4 text-slate-500" />
                            {section.genre}
                          </CardTitle>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {section.albumCount} 张专辑 · {section.artistCount} 位艺人
                            {section.yearRange ? ` · ${section.yearRange}` : ""}
                          </p>
                        </CardHeader>
                        <CardContent className="p-3 pt-0">
                          <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
                            {section.albums.map((album) => {
                              const coverUrl = getAlbumCoverUrl(album.coverArt, 384);
                              const albumMeta = getAlbumSecondaryMeta(album);

                              return (
                                <div
                                  key={`discover-${section.key}-${album.id}`}
                                  className="w-40 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white text-left transition-colors hover:border-[var(--accent-border)] dark:border-slate-800 dark:bg-slate-900"
                                >
                                  <button
                                    type="button"
                                    onClick={() => handleOpenAlbumDetail(album.id)}
                                    className="block w-full text-left"
                                  >
                                    <div className="aspect-square overflow-hidden border-b border-slate-200 dark:border-slate-800">
                                      {coverUrl ? (
                                        <img
                                          src={coverUrl}
                                          alt={`${album.title} cover`}
                                          className="h-full w-full object-cover"
                                          loading="lazy"
                                        />
                                      ) : (
                                        <div className="h-full w-full bg-[radial-gradient(circle_at_20%_20%,rgba(16,185,129,0.24),transparent_40%),radial-gradient(circle_at_80%_80%,rgba(59,130,246,0.2),transparent_42%)]" />
                                      )}
                                    </div>
                                    <div className="px-3 pt-3">
                                      <p className="truncate text-sm font-medium">{album.title}</p>
                                    </div>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenArtistDetail(album.artist)}
                                    className="block max-w-full truncate px-3 text-left text-xs text-slate-500 transition-colors hover:text-[var(--accent-text)] hover:underline dark:text-slate-400"
                                  >
                                    {album.artist}
                                  </button>
                                  {albumMeta ? (
                                    <p className="px-3 pb-3 pt-1 truncate text-[0.68rem] text-slate-500 dark:text-slate-400">
                                      {albumMeta}
                                    </p>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Card>
                    <CardContent className="pt-5 text-sm text-slate-600 dark:text-slate-300">
                      没有可展示的流派推荐，请先同步更多带流派标签的专辑。
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <CalendarDays className="h-4 w-4 text-slate-500" />
                      不重复探索池
                    </CardTitle>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      仅包含首页未出现过的专辑，按年代与更新时间混排。
                    </p>
                  </CardHeader>
                  <CardContent className="p-3 pt-0">
                    {discoverFreshAlbums.length > 0 ? (
                      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
                        {discoverFreshAlbums.map((album) => {
                          const coverUrl = getAlbumCoverUrl(album.coverArt, 384);

                          return (
                            <AlbumGridItem
                              key={`discover-pool-${album.id}`}
                              id={album.id}
                              title={album.title}
                              artist={album.artist}
                              coverUrl={coverUrl}
                              onClick={handleOpenAlbumDetail}
                              onArtistClick={handleOpenArtistDetail}
                            />
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex h-24 items-center justify-center rounded-lg text-sm text-slate-500">
                        没有可展示的去重专辑
                      </div>
                    )}
                  </CardContent>
                </Card>
              </section>
            )}

            {isArtistsView && (
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <Mic2 className="h-4 w-4 text-slate-500" />
                  <h2 className="text-sm font-medium">艺人列表</h2>
                </div>

                <Card>
                  <CardContent className="p-3">
                    {artistSummaries.length > 0 ? (
                      <div className="space-y-2">
                        {artistSummaries.map((artist) => (
                          <div
                            key={artist.artist}
                            className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 dark:border-slate-800/80 dark:bg-slate-900"
                          >
                            <div className="min-w-0">
                              <button
                                type="button"
                                onClick={() => handleOpenArtistDetail(artist.artist)}
                                className="truncate text-sm font-medium transition-colors hover:text-[var(--accent-text)] hover:underline"
                              >
                                {artist.artist}
                              </button>
                              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                                {artist.albumCount} 张专辑 · {artist.songCount} 首歌曲
                                {artist.latestYear ? ` · 最近 ${artist.latestYear}` : ""}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenArtistDetail(artist.artist)}
                            >
                              查看详情
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex h-24 items-center justify-center rounded-lg text-sm text-slate-500">
                        没有匹配到艺人
                      </div>
                    )}
                  </CardContent>
                </Card>
              </section>
            )}

            {isArtistDetailView && (
              <section className="space-y-6">
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm" onClick={handleBackToArtists}>
                    <ArrowLeft className="h-4 w-4" />
                    返回艺人列表
                  </Button>
                </div>

                {!normalizedSelectedArtistName ? (
                  <Card>
                    <CardContent className="pt-5 text-sm text-slate-600 dark:text-slate-300">
                      请先从“艺人列表”或搜索页的 Top Result 进入艺人详情。
                    </CardContent>
                  </Card>
                ) : artistDetailError ? (
                  <Card className="border-rose-200 bg-rose-50 dark:border-rose-900/40 dark:bg-rose-900/20">
                    <CardContent className="pt-4 text-sm text-slate-700 dark:text-slate-200">
                      {artistDetailErrorObj instanceof Error
                        ? artistDetailErrorObj.message
                        : "艺人详情加载失败"}
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    {/* Artist Hero Banner */}
                    <div className="relative overflow-hidden rounded-2xl border border-slate-200/60 dark:border-slate-800/60">
                      <div className="absolute inset-0 bg-gradient-to-br from-[var(--accent-soft-strong)] via-slate-100/80 to-blue-50/60 dark:from-slate-900 dark:via-[rgba(var(--accent-rgb),0.12)] dark:to-slate-950" />
                      {artistDetailLoading ? (
                        <div className="relative flex h-52 items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-300">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          加载艺人详情...
                        </div>
                      ) : (
                        <div className="relative p-6 sm:p-8">
                          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                            <div className="h-32 w-32 shrink-0 overflow-hidden rounded-2xl border-2 border-white/50 shadow-xl dark:border-slate-700/50">
                              {shouldShowArtistImage ? (
                                <img
                                  src={artistDetailImageUrl ?? undefined}
                                  alt={`${normalizedSelectedArtistName} avatar`}
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                  onError={() => setArtistImageLoadFailed(true)}
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--accent-soft-strong)] to-blue-400/20 text-3xl font-bold tracking-wide text-[var(--accent-text)]">
                                  {artistDetailArtistInitials}
                                </div>
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <p className="mb-1 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                                Artist
                              </p>
                              <h2 className="text-3xl font-bold tracking-tight">
                                {normalizedSelectedArtistName}
                              </h2>

                              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
                                <span>{artistDetailAlbums.length} 张专辑</span>
                                <span className="text-slate-400">·</span>
                                <span>{artistDetailSongs.length} 首歌曲</span>
                                {artistDetailSongs.length > 0 && (
                                  <>
                                    <span className="text-slate-400">·</span>
                                    <span>{formatDuration(artistDetailSongDurationSeconds)}</span>
                                  </>
                                )}
                                {artistYearRange && (
                                  <>
                                    <span className="text-slate-400">·</span>
                                    <span>{artistYearRange}</span>
                                  </>
                                )}
                              </div>

                              {artistGenreTags.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                  {artistGenreTags.map((genre) => (
                                    <span
                                      key={genre}
                                      className="rounded-full border border-slate-200/80 bg-white/60 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/50 dark:text-slate-300"
                                    >
                                      {genre}
                                    </span>
                                  ))}
                                </div>
                              )}

                              <div className="mt-3">
                                <p
                                  className={cn(
                                    "text-xs leading-relaxed text-slate-600 dark:text-slate-400",
                                    artistBiography && !isBioExpanded && "line-clamp-3",
                                  )}
                                >
                                  {artistBiography || "暂无歌手介绍。"}
                                </p>
                                {artistBiography.length > 150 && (
                                  <button
                                    type="button"
                                    onClick={() => setBioExpanded(!isBioExpanded)}
                                    className="mt-1 text-xs font-medium text-[var(--accent-text)] hover:underline"
                                  >
                                    {isBioExpanded ? "收起" : "展开"}
                                  </button>
                                )}
                              </div>

                              <div className="mt-4 flex items-center gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    const firstSong = artistDetailSongs[0];
                                    if (firstSong) handlePlayArtistDetailSong(firstSong.id);
                                  }}
                                  disabled={artistDetailSongs.length === 0}
                                >
                                  播放全部
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    if (!client || artistDetailSongs.length === 0) return;
                                    const queue = shuffleArray(
                                      artistDetailSongs.map((song) => mapSongToTrackInfo(song, client)),
                                    );
                                    setQueue(queue, 0);
                                    setPlaying(true);
                                  }}
                                  disabled={artistDetailSongs.length === 0}
                                >
                                  <Shuffle className="mr-1.5 h-3.5 w-3.5" />
                                  随机播放
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Albums Grid */}
                    {!artistDetailLoading && (
                      <div>
                        <div className="mb-3 flex items-center gap-2">
                          <Disc3 className="h-4 w-4 text-slate-500" />
                          <h3 className="text-sm font-semibold">
                            专辑作品 ({artistDetailAlbums.length})
                          </h3>
                        </div>
                        {artistDetailAlbums.length > 0 ? (
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                            {artistDetailAlbums.map((album) => {
                              const coverUrl = getAlbumCoverUrl(album.coverArt, 280);
                              const albumMeta = [
                                album.year ? `${album.year}` : null,
                                album.songCount ? `${album.songCount} 首` : null,
                              ]
                                .filter(Boolean)
                                .join(" · ");

                              return (
                                <button
                                  key={album.id}
                                  type="button"
                                  onClick={() => handleOpenAlbumDetail(album.id)}
                                  className="group text-left outline-none"
                                >
                                  <div className="aspect-square w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 transition-colors group-hover:border-[var(--accent-border)] dark:border-slate-800 dark:bg-slate-900/50">
                                    {coverUrl ? (
                                      <img
                                        src={coverUrl}
                                        alt={`${album.name} cover`}
                                        className="h-full w-full object-cover"
                                        loading="lazy"
                                      />
                                    ) : (
                                      <div className="h-full w-full bg-[radial-gradient(circle_at_20%_20%,rgba(16,185,129,0.24),transparent_40%),radial-gradient(circle_at_80%_80%,rgba(59,130,246,0.2),transparent_42%)]" />
                                    )}
                                  </div>
                                  <div className="mt-2 min-w-0 px-0.5">
                                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                      {album.name}
                                    </p>
                                    {albumMeta && (
                                      <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                                        {albumMeta}
                                      </p>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="flex h-24 items-center justify-center rounded-lg text-sm text-slate-500">
                            没有匹配到专辑
                          </div>
                        )}
                      </div>
                    )}

                    {/* Songs Table */}
                    {!artistDetailLoading && (
                      <div>
                        <div className="mb-3 flex items-center gap-2">
                          <Music2 className="h-4 w-4 text-slate-500" />
                          <h3 className="text-sm font-semibold">
                            全部歌曲 ({artistDetailSongs.length})
                          </h3>
                        </div>
                        {artistDetailSongs.length > 0 ? (
                          <div className="overflow-hidden rounded-xl border border-slate-200/90 dark:border-slate-800/90">
                            <div className="overflow-x-auto scrollbar-thin">
                              <div className="min-w-[760px]">
                                <div className="grid grid-cols-[44px_minmax(220px,2.3fr)_minmax(180px,1.45fr)_minmax(180px,1.55fr)_62px] items-center bg-slate-100/80 px-4 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:bg-slate-900/80 dark:text-slate-400">
                                  <span>#</span>
                                  <span>标题</span>
                                  <span>艺人</span>
                                  <span>专辑</span>
                                  <span className="justify-self-end">时长</span>
                                </div>
                                <div className="divide-y divide-slate-200/70 dark:divide-slate-800/90">
                                  {artistDetailSongs.map((song, index) => (
                                    <div
                                      key={song.id}
                                      className={cn(
                                        "group grid w-full grid-cols-[44px_minmax(220px,2.3fr)_minmax(180px,1.45fr)_minmax(180px,1.55fr)_62px] items-center px-4 py-2 text-left outline-none transition-colors duration-150",
                                        "hover:bg-slate-100/90 dark:hover:bg-slate-800/60",
                                        currentTrackId === song.id
                                          ? "bg-[var(--accent-soft)] text-[var(--accent-text)]"
                                          : "text-slate-700 dark:text-slate-200",
                                      )}
                                    >
                                      <span className={cn(
                                        "text-sm font-semibold tabular-nums text-slate-500 transition-colors group-hover:text-slate-700 dark:text-slate-400 dark:group-hover:text-slate-200",
                                        currentTrackId === song.id && "text-[var(--accent-solid)]",
                                      )}>
                                        {index + 1}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => handlePlayArtistDetailSong(song.id)}
                                        className="truncate text-left text-sm font-medium transition-colors hover:text-[var(--accent-text)]"
                                      >
                                        {song.title}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => { if (song.artist) handleOpenArtistDetail(song.artist); }}
                                        disabled={!song.artist}
                                        className="truncate text-left text-xs text-slate-500 transition-colors hover:text-[var(--accent-text)] hover:underline disabled:cursor-default disabled:hover:no-underline dark:text-slate-400"
                                      >
                                        {song.artist ?? "未知艺术家"}
                                      </button>
                                      {song.albumId ? (
                                        <button
                                          type="button"
                                          onClick={() => handleOpenAlbumDetail(song.albumId!)}
                                          className="truncate text-left text-xs text-slate-500 transition-colors hover:text-[var(--accent-text)] hover:underline dark:text-slate-400"
                                        >
                                          {song.album ?? "未知专辑"}
                                        </button>
                                      ) : (
                                        <span className="truncate text-xs text-slate-500 dark:text-slate-400">
                                          {song.album ?? "未知专辑"}
                                        </span>
                                      )}
                                      <span className="justify-self-end text-[0.7rem] tabular-nums text-slate-500 dark:text-slate-400">
                                        {formatTime(song.duration ?? 0)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex h-24 items-center justify-center rounded-lg text-sm text-slate-500">
                            没有匹配到歌曲
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </section>
            )}

            {isPlaylistDetailView && (
              <section className="space-y-5">
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm" onClick={handleBackToPlaylists}>
                    <ArrowLeft className="h-4 w-4" />
                    返回歌单列表
                  </Button>
                </div>

                {!selectedPlaylist ? (
                  <Card>
                    <CardContent className="pt-5 text-sm text-slate-600 dark:text-slate-300">
                      未找到歌单，请返回列表重新选择。
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    <div className="relative overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800/90">
                      {selectedPlaylistCoverUrl && (
                        <div
                          aria-hidden
                          className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-20 blur-3xl saturate-150"
                          style={{ backgroundImage: `url(${selectedPlaylistCoverUrl})` }}
                        />
                      )}
                      <div className="relative p-6 sm:p-8">
                        <div className="flex flex-col gap-6 sm:flex-row">
                          {selectedPlaylistCoverUrl ? (
                            <img
                              src={selectedPlaylistCoverUrl}
                              alt={`${selectedPlaylistName || "playlist"} cover`}
                              className="h-52 w-52 shrink-0 rounded-2xl border border-white/30 object-cover shadow-2xl dark:border-slate-700/40"
                            />
                          ) : (
                            <div className="h-52 w-52 shrink-0 rounded-2xl bg-[radial-gradient(circle_at_20%_20%,rgba(16,185,129,0.24),transparent_40%),radial-gradient(circle_at_80%_80%,rgba(59,130,246,0.2),transparent_42%)]" />
                          )}

                          <div className="flex min-w-0 flex-1 flex-col justify-end">
                            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                              Playlist
                            </p>
                            <h2 className="mt-1 text-3xl font-bold tracking-tight">
                              {selectedPlaylistName || "未命名歌单"}
                            </h2>

                            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-slate-600 dark:text-slate-300">
                              <span>{selectedPlaylistSongCount} 首</span>
                              <span className="text-slate-400">·</span>
                              <span>{formatDuration(selectedPlaylistDurationSeconds)}</span>
                              {selectedPlaylistOwner ? (
                                <>
                                  <span className="text-slate-400">·</span>
                                  <span>{selectedPlaylistOwner}</span>
                                </>
                              ) : null}
                              {selectedPlaylistUpdatedAtLabel ? (
                                <>
                                  <span className="text-slate-400">·</span>
                                  <span>更新于 {selectedPlaylistUpdatedAtLabel}</span>
                                </>
                              ) : null}
                            </p>

                            {selectedPlaylistComment ? (
                              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                {selectedPlaylistComment}
                              </p>
                            ) : null}

                            <div className="mt-5 flex items-center gap-2">
                              <Button
                                onClick={handlePlayPlaylistAll}
                                disabled={selectedPlaylistQueue.length === 0 || playlistDetailLoading}
                              >
                                播放全部
                              </Button>
                              <Button
                                variant="outline"
                                onClick={handleShufflePlaylist}
                                disabled={selectedPlaylistQueue.length === 0 || playlistDetailLoading}
                              >
                                <Shuffle className="mr-2 h-4 w-4" />
                                打乱播放
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <section>
                      <div className="mb-3 flex items-center gap-2">
                        <ListMusic className="h-4 w-4 text-slate-500" />
                        <h2 className="text-sm font-medium">
                          歌曲列表 · {selectedPlaylistName || "当前歌单"}
                        </h2>
                      </div>

                      <Card>
                        <CardContent className="p-0">
                          {playlistDetailError ? (
                            <div className="rounded-b-xl bg-rose-50 p-4 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-200">
                              {playlistDetailErrorObj instanceof Error
                                ? playlistDetailErrorObj.message
                                : "歌单详情加载失败"}
                            </div>
                          ) : playlistDetailLoading ? (
                            <div className="flex h-24 items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-300">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              正在加载歌单歌曲...
                            </div>
                          ) : selectedPlaylistSongs.length > 0 ? (
                            <div className="overflow-x-auto pb-1 scrollbar-thin">
                              <div className="min-w-[760px] overflow-hidden rounded-b-xl border-y border-slate-200/90 dark:border-slate-800/90">
                                <div className="grid grid-cols-[44px_minmax(220px,2.3fr)_minmax(180px,1.45fr)_minmax(180px,1.55fr)_62px] items-center bg-slate-100/80 px-4 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:bg-slate-900/80 dark:text-slate-400">
                                  <span>#</span>
                                  <span>标题</span>
                                  <span>艺人</span>
                                  <span>专辑</span>
                                  <span className="justify-self-end">时长</span>
                                </div>
                                <div className="divide-y divide-slate-200/70 dark:divide-slate-800/90">
                                  {selectedPlaylistSongs.map((song, index) => (
                                    <div
                                      key={`playlist-song-${song.id}-${index}`}
                                      className={cn(
                                        "group grid w-full grid-cols-[44px_minmax(220px,2.3fr)_minmax(180px,1.45fr)_minmax(180px,1.55fr)_62px] items-center px-4 py-2 text-left outline-none transition-colors duration-150",
                                        "hover:bg-slate-100/90 dark:hover:bg-slate-800/60",
                                        currentTrackId === song.id
                                          ? "bg-[var(--accent-soft)] text-[var(--accent-text)]"
                                          : "text-slate-700 dark:text-slate-200",
                                      )}
                                    >
                                      <span className={cn(
                                        "text-sm font-semibold tabular-nums text-slate-500 transition-colors group-hover:text-slate-700 dark:text-slate-400 dark:group-hover:text-slate-200",
                                        currentTrackId === song.id && "text-[var(--accent-solid)]",
                                      )}>
                                        {index + 1}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => handlePlayPlaylistSong(song.id)}
                                        className="truncate text-left text-sm font-medium transition-colors hover:text-[var(--accent-text)]"
                                      >
                                        {song.title}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => { if (song.artist) handleOpenArtistDetail(song.artist); }}
                                        disabled={!song.artist}
                                        className="truncate text-left text-xs text-slate-500 transition-colors hover:text-[var(--accent-text)] hover:underline disabled:cursor-default disabled:hover:no-underline dark:text-slate-400"
                                      >
                                        {song.artist ?? "未知艺术家"}
                                      </button>
                                      {song.albumId ? (
                                        <button
                                          type="button"
                                          onClick={() => handleOpenAlbumDetail(song.albumId!)}
                                          className="truncate text-left text-xs text-slate-500 transition-colors hover:text-[var(--accent-text)] hover:underline dark:text-slate-400"
                                        >
                                          {song.album ?? "未知专辑"}
                                        </button>
                                      ) : (
                                        <span className="truncate text-xs text-slate-500 dark:text-slate-400">
                                          {song.album ?? "未知专辑"}
                                        </span>
                                      )}
                                      <span className="justify-self-end text-[0.7rem] tabular-nums text-slate-500 dark:text-slate-400">
                                        {formatTime(song.duration ?? 0)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="flex h-24 items-center justify-center text-sm text-slate-500">
                              当前歌单没有可显示歌曲
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </section>
                  </>
                )}
              </section>
            )}

            {isSongsView && (
              <section className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <Music2 className="h-4 w-4 text-slate-500" />
                    <div>
                      <h2 className="text-sm font-medium">全部歌曲</h2>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {songsLoading ? "正在同步全库歌曲..." : `共 ${filteredSongs.length} 首歌曲`}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      onClick={handlePlayAlbumAll}
                      disabled={songsLoading || visibleSongs.length === 0}
                    >
                      播放全部
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleShuffleAlbum}
                      disabled={songsLoading || visibleSongs.length === 0}
                    >
                      <Shuffle className="mr-1.5 h-3.5 w-3.5" />
                      打乱播放
                    </Button>
                  </div>
                </div>

                <Card>
                  <CardContent className="p-2">
                    <div className="p-1">
                      {songsLoading ? (
                        Array.from({ length: 8 }).map((_, index) => (
                          <div
                            key={`songs-view-skeleton-${index}`}
                            className="mb-1 h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800"
                          />
                        ))
                      ) : filteredSongs.length > 0 ? (
                        <>
                          {displayedSongs.map((song, index) => (
                            <SongListItem
                              key={`songs-view-${song.id}`}
                              id={song.id}
                              index={songPageStart + index}
                              title={song.title}
                              artist={getSongArtistNames(song).join(" / ")}
                              artistNames={getSongArtistNames(song)}
                              duration={formatTime(song.duration ?? 0)}
                              isPlaying={currentTrackId === song.id}
                              onClick={handlePlaySong}
                              onArtistClick={handleOpenArtistDetail}
                            />
                          ))}
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-2 text-xs text-slate-500 dark:text-slate-400">
                            <p>
                              第 {currentSongPageIndex + 1} / {songPageCount} 页 · 共 {filteredSongs.length} 首歌曲
                            </p>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handlePreviousSongPage}
                                disabled={currentSongPageIndex === 0}
                              >
                                上一页
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handleNextSongPage}
                                disabled={currentSongPageIndex >= songPageCount - 1}
                              >
                                下一页
                              </Button>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="flex h-24 items-center justify-center rounded-lg text-sm text-slate-500">
                          没有可显示歌曲
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </section>
            )}

            {isLovedTracksView && (
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <Heart className="h-4 w-4 text-slate-500" />
                  <h2 className="text-sm font-medium">我喜欢的歌曲</h2>
                </div>

                <Card>
                  <CardContent className="p-2">
                    <div className="p-1">
                      {lovedTracksError ? (
                        <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-200">
                          {lovedTracksErrorObj instanceof Error
                            ? lovedTracksErrorObj.message
                            : "加载喜欢列表失败"}
                        </div>
                      ) : lovedTracksLoading ? (
                        Array.from({ length: 8 }).map((_, index) => (
                          <div
                            key={`loved-track-skeleton-${index}`}
                            className="mb-1 h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800"
                          />
                        ))
                      ) : filteredLovedTracks.length > 0 ? (
                        <>
                          {filteredLovedTracks.map((song, index) => (
                            <SongListItem
                              key={`loved-track-${song.id}`}
                              id={song.id}
                              index={index}
                              title={song.title}
                              artist={getSongArtistNames(song).join(" / ")}
                              artistNames={getSongArtistNames(song)}
                              duration={formatTime(song.duration ?? 0)}
                              isPlaying={currentTrackId === song.id}
                              onClick={handlePlayLovedTrack}
                              onArtistClick={handleOpenArtistDetail}
                            />
                          ))}
                        </>
                      ) : (
                        <div className="flex h-24 items-center justify-center rounded-lg text-sm text-slate-500">
                          暂无喜欢歌曲，先在服务端收藏后会自动显示在这里
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </section>
            )}

            {isGenresView && (
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <Tags className="h-4 w-4 text-slate-500" />
                  <h2 className="text-sm font-medium">流派列表</h2>
                </div>

                <Card>
                  <CardContent className="p-3">
                    {genresError ? (
                      <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-200">
                        {genresErrorObj instanceof Error ? genresErrorObj.message : "流派数据加载失败"}
                      </div>
                    ) : genresLoading ? (
                      <div className="space-y-2">
                        {Array.from({ length: 6 }).map((_, index) => (
                          <div
                            key={`genre-skeleton-${index}`}
                            className="h-12 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800"
                          />
                        ))}
                      </div>
                    ) : genreSummaries.length > 0 ? (
                      <div className="space-y-2">
                        {genreSummaries.map((genre) => (
                          <div
                            key={genre.name}
                            className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 dark:border-slate-800/80 dark:bg-slate-900"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{genre.name}</p>
                              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                                {genre.albumCount} 张专辑 · {genre.songCount} 首歌曲
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setSearchInput(genre.name);
                                setSearchKeyword(genre.name);
                                handleNavigateSection("albums");
                              }}
                            >
                              查看流派
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex h-24 items-center justify-center rounded-lg text-sm text-slate-500">
                        暂无流派数据
                      </div>
                    )}
                  </CardContent>
                </Card>
              </section>
            )}

            {isFoldersView && (
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <FolderTree className="h-4 w-4 text-slate-500" />
                  <h2 className="text-sm font-medium">文件夹视图</h2>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">音乐目录</CardTitle>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {musicFoldersData.length > 0
                        ? "目录来自服务器根音乐文件夹。"
                        : "服务器未返回目录，已回退为当前专辑的本地路径聚合。"}
                    </p>
                  </CardHeader>
                  <CardContent className="p-3 pt-0">
                    {musicFoldersError ? (
                      <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-200">
                        {musicFoldersErrorObj instanceof Error
                          ? musicFoldersErrorObj.message
                          : "目录数据加载失败"}
                      </div>
                    ) : musicFoldersLoading ? (
                      <div className="space-y-2">
                        {Array.from({ length: 5 }).map((_, index) => (
                          <div
                            key={`folder-skeleton-${index}`}
                            className="h-12 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800"
                          />
                        ))}
                      </div>
                    ) : folderSummaries.length > 0 ? (
                      <div className="space-y-2">
                        {folderSummaries.map((folder) => (
                          <div
                            key={folder.id}
                            className="rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 dark:border-slate-800/80 dark:bg-slate-900"
                          >
                            <p className="truncate text-sm font-medium">{folder.name}</p>
                            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                              {folder.songCount !== null
                                ? `${folder.songCount} 首歌曲`
                                : "服务器音乐目录"}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex h-24 items-center justify-center rounded-lg text-sm text-slate-500">
                        暂无可展示文件夹
                      </div>
                    )}
                  </CardContent>
                </Card>
              </section>
            )}

            {isAlbumDetailView && (
              <>
                <section className="space-y-5">
                  <div className="flex items-center gap-3">
                    <Button variant="outline" size="sm" onClick={handleBackToAlbums}>
                      <ArrowLeft className="h-4 w-4" />
                      返回专辑列表
                    </Button>
                  </div>

                  {/* Album Hero */}
                  <div className="relative overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800/90">
                    {selectedCoverUrl && (
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-20 blur-3xl saturate-150"
                        style={{ backgroundImage: `url(${selectedCoverUrl})` }}
                      />
                    )}
                    <div className="relative p-6 sm:p-8">
                      <div className="flex flex-col gap-6 sm:flex-row">
                        {selectedCoverUrl ? (
                          <img
                            src={selectedCoverUrl}
                            alt={`${selectedAlbum?.title ?? "album"} cover`}
                            className="h-52 w-52 shrink-0 rounded-2xl border border-white/30 object-cover shadow-2xl dark:border-slate-700/40"
                          />
                        ) : (
                          <div className="h-52 w-52 shrink-0 rounded-2xl bg-[radial-gradient(circle_at_20%_20%,rgba(16,185,129,0.24),transparent_40%),radial-gradient(circle_at_80%_80%,rgba(59,130,246,0.2),transparent_42%)]" />
                        )}

                        <div className="flex min-w-0 flex-1 flex-col justify-end">
                          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                            Album
                          </p>
                          <h2 className="mt-1 text-3xl font-bold tracking-tight">
                            {selectedAlbum?.title ?? "未选择专辑"}
                          </h2>
                          {selectedAlbum?.artist ? (
                            <button
                              type="button"
                              onClick={() => handleOpenArtistDetail(selectedAlbum.artist)}
                              className="mt-1.5 w-fit text-sm font-medium text-slate-600 transition-colors hover:text-[var(--accent-text)] hover:underline dark:text-slate-300"
                            >
                              {selectedAlbum.artist}
                            </button>
                          ) : (
                            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">
                              未知艺术家
                            </p>
                          )}

                          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-slate-600 dark:text-slate-300">
                            {selectedAlbum?.year && (
                              <>
                                <span>{selectedAlbum.year}</span>
                                <span className="text-slate-400">·</span>
                              </>
                            )}
                            {selectedAlbumGenre && (
                              <>
                                <span>{selectedAlbumGenre}</span>
                                <span className="text-slate-400">·</span>
                              </>
                            )}
                            <span>{selectedAlbumSongCount} 首</span>
                            <span className="text-slate-400">·</span>
                            <span>{formatDuration(selectedAlbumDurationSeconds)}</span>
                          </p>

                          {albumFormatInfo && (
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              {albumFormatInfo}
                            </p>
                          )}

                          <div className="mt-5 flex items-center gap-2">
                            <Button onClick={handlePlayAlbumAll} disabled={visibleSongs.length === 0}>
                              播放全部
                            </Button>
                            <Button
                              variant="outline"
                              onClick={handleShuffleAlbum}
                              disabled={visibleSongs.length === 0}
                            >
                              <Shuffle className="mr-2 h-4 w-4" />
                              打乱播放
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <section>
                  <div className="mb-3 flex items-center gap-2">
                    <ListMusic className="h-4 w-4 text-slate-500" />
                    <h2 className="text-sm font-medium">
                      歌曲列表{selectedAlbum ? ` · ${selectedAlbum.title}` : ""}
                    </h2>
                  </div>

                  {songsLoading ? (
                    <Card>
                      <CardContent className="p-2">
                        <div className="p-1">
                          {Array.from({ length: 8 }).map((_, index) => (
                            <div
                              key={`song-skeleton-${index}`}
                              className="mb-1 h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800"
                            />
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ) : filteredSongs.length > 0 ? (
                    <div className="overflow-hidden rounded-xl border border-slate-200/90 dark:border-slate-800/90">
                      <div className="overflow-x-auto scrollbar-thin">
                        <div className="min-w-[980px]">
                          <div className="grid grid-cols-[44px_minmax(200px,2.2fr)_minmax(140px,1.1fr)_minmax(140px,1.1fr)_minmax(170px,1.25fr)_62px] items-center bg-slate-100/80 px-4 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:bg-slate-900/80 dark:text-slate-400">
                            <span>#</span>
                            <span>标题</span>
                            <span>艺人</span>
                            <span>专辑</span>
                            <span>品质</span>
                            <span className="justify-self-end">时长</span>
                          </div>
                          <div className="divide-y divide-slate-200/70 dark:divide-slate-800/90">
                            {displayedSongs.map((song, index) => {
                              const audioQuality = resolveAudioQuality({
                                suffix: song.suffix,
                                bitDepth: song.bitDepth,
                                sampleRate: song.sampleRate ?? song.samplingRate,
                              });

                              return (
                                <div
                                  key={song.id}
                                  className={cn(
                                    "group grid w-full grid-cols-[44px_minmax(200px,2.2fr)_minmax(140px,1.1fr)_minmax(140px,1.1fr)_minmax(170px,1.25fr)_62px] items-center px-4 py-2 text-left outline-none transition-colors duration-150",
                                    "hover:bg-slate-100/90 dark:hover:bg-slate-800/60",
                                    currentTrackId === song.id
                                      ? "bg-[var(--accent-soft)] text-[var(--accent-text)]"
                                      : "text-slate-700 dark:text-slate-200",
                                  )}
                                >
                                  <span
                                    className={cn(
                                      "text-sm font-semibold tabular-nums text-slate-500 transition-colors group-hover:text-slate-700 dark:text-slate-400 dark:group-hover:text-slate-200",
                                      currentTrackId === song.id && "text-[var(--accent-solid)]",
                                    )}
                                  >
                                    {songPageStart + index + 1}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handlePlaySong(song.id)}
                                    className="truncate text-left text-sm font-medium transition-colors hover:text-[var(--accent-text)]"
                                  >
                                    {song.title}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { if (song.artist) handleOpenArtistDetail(song.artist); }}
                                    disabled={!song.artist}
                                    className="truncate text-left text-xs text-slate-500 transition-colors hover:text-[var(--accent-text)] hover:underline disabled:cursor-default disabled:hover:no-underline dark:text-slate-400"
                                  >
                                    {song.artist ?? "未知艺术家"}
                                  </button>
                                  {song.albumId ? (
                                    <button
                                      type="button"
                                      onClick={() => handleOpenAlbumDetail(song.albumId!)}
                                      className="truncate text-left text-xs text-slate-500 transition-colors hover:text-[var(--accent-text)] hover:underline dark:text-slate-400"
                                    >
                                      {song.album ?? "未知专辑"}
                                    </button>
                                  ) : (
                                    <span className="truncate text-xs text-slate-500 dark:text-slate-400">
                                      {song.album ?? "未知专辑"}
                                    </span>
                                  )}
                                  <span className="truncate text-[0.68rem] tabular-nums text-slate-400 dark:text-slate-500">
                                    <span className="inline-flex items-center gap-1.5">
                                      {audioQuality ? (
                                        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200/80 bg-slate-100/80 px-2 py-0.5 text-[0.64rem] font-medium tracking-normal text-slate-600 dark:border-slate-700/80 dark:bg-slate-800/70 dark:text-slate-200">
                                          <AudioLines className="h-3 w-3 shrink-0 text-emerald-500 dark:text-emerald-400" />
                                          <span>{audioQuality.label}</span>
                                          {audioQuality.parameterText ? (
                                            <span className="text-slate-500 dark:text-slate-300">
                                              {audioQuality.parameterText}
                                            </span>
                                          ) : null}
                                        </span>
                                      ) : null}
                                      {song.bitRate ? (
                                        <span className="text-[0.64rem] text-slate-500 dark:text-slate-400">
                                          {song.bitRate}k
                                        </span>
                                      ) : null}
                                    </span>
                                  </span>
                                  <span className="justify-self-end text-[0.7rem] tabular-nums text-slate-500 dark:text-slate-400">
                                    {formatTime(song.duration ?? 0)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                      {songPageCount > 1 && (
                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 px-4 py-2 text-xs text-slate-500 dark:border-slate-800/90 dark:text-slate-400">
                          <p>
                            第 {currentSongPageIndex + 1} / {songPageCount} 页 · 共 {filteredSongs.length} 首歌曲
                          </p>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handlePreviousSongPage}
                              disabled={currentSongPageIndex === 0}
                            >
                              上一页
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleNextSongPage}
                              disabled={currentSongPageIndex >= songPageCount - 1}
                            >
                              下一页
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <Card>
                      <CardContent className="p-2">
                        <div className="flex h-24 items-center justify-center rounded-lg p-1 text-sm text-slate-500">
                          当前专辑没有可显示歌曲
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </section>
              </>
            )}
          </>
        )}

          {isLibraryView && (albumLoading || songsLoading) && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在同步 Navidrome 数据...
            </div>
          )}
              </motion.div>
            </div>
          </main>
        </div>

        <Suspense fallback={null}>
          {hasLoadedNowPlayingSheet && (
            <LazyNowPlayingSheet
              open={isNowPlayingSheetOpen}
              currentTrack={currentTrack}
              queue={queue}
              isPlaying={isPlaying}
              lyrics={lyricsData}
              lyricsLoading={lyricsLoading}
              lyricsFontScale={lyricsFontScale}
              lyricsAlign={lyricsAlign}
              showTranslatedLyrics={showTranslatedLyrics}
              showRomanizedLyrics={showRomanizedLyrics}
              backgroundBlurEnabled={nowPlayingBackgroundBlurEnabled}
              highResCoverUrl={nowPlayingHighResCoverUrl}
              onClose={handleCloseNowPlayingSheet}
              onSelectTrack={handleSelectQueueTrack}
              onArtistClick={handleOpenArtistDetail}
              onAlbumClick={handleOpenAlbumDetail}
            />
          )}
          {hasLoadedSettingsPanel && (
            <LazySettingsPanel
              open={isSettingsPanelOpen}
              onClose={handleCloseSettingsPanel}
              updateChecker={updateChecker}
            />
          )}
        </Suspense>

        <PlayerBar
          nowPlayingOpen={isNowPlayingSheetOpen}
          onOpenNowPlaying={handleOpenNowPlayingSheet}
          onToggleNowPlaying={handleToggleNowPlayingSheet}
          onArtistClick={handleOpenArtistDetail}
          onAlbumClick={handleOpenAlbumDetail}
          onSelectTrack={handleSelectQueueTrack}
        />
      </div>
    </div>
  );
}
