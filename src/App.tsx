import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarDays,
  Clock3,
  Disc3,
  ListMusic,
  Loader2,
  Mic2,
  Music2,
  Shuffle,
  Tags,
} from "lucide-react";
import { useEffect, useMemo, useState, useCallback, useRef } from "react";

import { LoginPanel } from "@/features/auth/components/LoginPanel";
import { PlayerBar } from "@/components/layout/PlayerBar";
import { SettingsPanel } from "@/components/layout/SettingsPanel";
import { Sidebar } from "@/components/layout/Sidebar";
import { WindowTitlebar } from "@/components/layout/WindowTitlebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { envDefaults } from "@/config/env";
import { useAlbumList } from "@/features/library/hooks/use-album-list";
import { useAlbumSongs } from "@/features/library/hooks/use-album-songs";
import { useGlobalSearch } from "@/features/library/hooks/use-global-search";
import { useLyrics } from "@/features/library/hooks/use-lyrics";
import { AlbumGridItem } from "@/features/library/components/AlbumGridItem";
import { SongListItem } from "@/features/library/components/SongListItem";
import { NowPlayingSheet } from "@/features/player/components/NowPlayingSheet";
import { mapSongToTrackInfo } from "@/features/player/utils/map-subsonic-song";
import { useMediaSession } from "@/hooks/use-media-session";
import { useSmoothScroll } from "@/hooks/use-smooth-scroll";
import { useTrayControls } from "@/hooks/use-tray-controls";
import { createSubsonicClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { type LibraryNavSection, useLibraryStore } from "@/stores/library-store";
import { usePlayerStore } from "@/stores/player-store";
import type { SubsonicAlbum } from "@/types/subsonic";


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
    artist: album.artist ?? "Unknown Artist",
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

function getAlbumColumns(viewportWidth: number) {
  if (viewportWidth >= 1280) {
    return 6;
  }

  if (viewportWidth >= 768) {
    return 3;
  }

  return 2;
}

export default function App() {
  useMediaSession();
  useTrayControls();

  const mainRef = useRef<HTMLElement>(null);
  useSmoothScroll(mainRef);

  const session = useAuthStore((state) => state.session);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoggingIn = useAuthStore((state) => state.isLoggingIn);
  const loginError = useAuthStore((state) => state.loginError);
  const login = useAuthStore((state) => state.login);
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

  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );
  const [isNowPlayingSheetOpen, setNowPlayingSheetOpen] = useState(false);
  const [isSettingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [isRefreshingLibrary, setRefreshingLibrary] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearchInput, setDebouncedSearchInput] = useState("");
  const [navHistory, setNavHistory] = useState<{
    stack: LibraryNavSection[];
    index: number;
  }>({
    stack: ["discover"],
    index: 0,
  });
  const queryClient = useQueryClient();

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
    const timer = window.setTimeout(() => {
      setDebouncedSearchInput(searchInput);
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [searchInput]);

  const client = useMemo(() => {
    if (!isAuthenticated || !session) {
      return null;
    }

    return createSubsonicClient(session);
  }, [isAuthenticated, session]);

  const sessionKey = isAuthenticated && session
    ? `${session.baseUrl}|${session.username}`
    : null;

  const {
    data: albumData = [],
    isLoading: albumLoading,
    isError: albumError,
    error: albumErrorObj,
  } = useAlbumList(client, sessionKey);

  const {
    data: songsData = [],
    isLoading: songsLoading,
    isError: songsError,
    error: songsErrorObj,
  } = useAlbumSongs(client, sessionKey, selectedAlbumId);
  const normalizedSearchKeyword = searchKeyword.trim();
  const normalizedSearchInput = searchInput.trim();
  const normalizedDebouncedSearchInput = debouncedSearchInput.trim();
  const {
    data: globalSearchData = { albums: [], songs: [] },
    isLoading: globalSearchLoading,
    isError: globalSearchError,
    error: globalSearchErrorObj,
  } = useGlobalSearch(client, sessionKey, normalizedSearchKeyword);
  const {
    data: suggestionSearchData = { albums: [], songs: [] },
  } = useGlobalSearch(client, sessionKey, normalizedDebouncedSearchInput);

  const albumCards = useMemo(() => albumData.map(toCardItem), [albumData]);

  const filteredAlbums = useMemo(
    () => albumCards.filter((album) => matchKeyword(searchKeyword, album.title, album.artist)),
    [albumCards, searchKeyword],
  );

  const visibleSongs = useMemo(
    () =>
      [...songsData].sort(
        (a, b) => (a.track ?? Number.MAX_SAFE_INTEGER) - (b.track ?? Number.MAX_SAFE_INTEGER),
      ),
    [songsData],
  );

  const filteredSongs = useMemo(
    () =>
      visibleSongs.filter((song) =>
        matchKeyword(searchKeyword, song.title, song.artist, song.album),
      ),
    [searchKeyword, visibleSongs],
  );

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
  }, [albumCards, searchKeyword]);

  const discoverRecentAlbums = useMemo(
    () =>
      [...filteredAlbums]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 12),
    [filteredAlbums],
  );
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

  useEffect(() => {
    if (isAuthenticated) {
      return;
    }

    setSelectedAlbumId(null);
    setSearchInput("");
    setDebouncedSearchInput("");
    setSearchKeyword("");
    setActiveNavSection("discover");
    setNowPlayingSheetOpen(false);
    setSettingsPanelOpen(false);
    setNavHistory({
      stack: ["discover"],
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
  ]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    setSelectedAlbumId(null);
  }, [sessionKey, isAuthenticated, setSelectedAlbumId]);

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
  const globalSearchAlbums = globalSearchData.albums;
  const globalSearchSongs = globalSearchData.songs;
  const suggestionAlbums = suggestionSearchData.albums;
  const suggestionSongs = suggestionSearchData.songs;
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

  const albumColumns = useMemo(() => getAlbumColumns(viewportWidth), [viewportWidth]);
  const albumGridAlbums = useMemo(
    () =>
      activeNavSection === "recent-added"
        ? [...filteredAlbums].sort((a, b) => b.createdAt - a.createdAt)
        : filteredAlbums,
    [activeNavSection, filteredAlbums],
  );

  const [displayLimit, setDisplayLimit] = useState(120);

  useEffect(() => {
    if (activeNavSection !== "albums" && activeNavSection !== "recent-added") {
      setDisplayLimit(120);
      return;
    }

    const timer = setTimeout(() => {
      setDisplayLimit(albumGridAlbums.length);
    }, 1500);

    return () => clearTimeout(timer);
  }, [activeNavSection, albumGridAlbums.length]);

  const displayedAlbums = useMemo(
    () => albumGridAlbums.slice(0, displayLimit),
    [albumGridAlbums, displayLimit]
  );

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

  const viewTitleMap = {
    discover: "发现",
    "recent-added": "最近播放",
    albums: "专辑",
    artists: "艺人",
    songs: "歌曲",
    "album-detail": "专辑详情",
    search: "全局搜索",
    playlists: "播放列表",
  } as const;

  const viewDescriptionMap = {
    discover: "浏览你的音乐库与专辑，点击底部播放栏左侧封面可展开正在播放。",
    "recent-added": "按最近播放与新增顺序浏览专辑，快速续播。",
    albums: "专辑列表已接入虚拟滚动，适合快速浏览与进入详情。",
    artists: "按专辑统计艺人，展示曲目规模与最近发行年份。",
    songs: "展示当前专辑曲目，可直接点选播放。",
    "album-detail": "展示专辑元数据并支持播放全部、打乱播放。",
    search: "跨全库搜索专辑与歌曲，结果来自 Subsonic search3。",
    playlists: "收藏歌单与新建歌单入口已预留，后续可扩展为真实列表管理。",
  } as const;

  const isPlaylistsView = activeNavSection === "playlists";
  const isSearchView = activeNavSection === "search";
  const isAlbumDetailView = activeNavSection === "album-detail";
  const isDiscoverView = activeNavSection === "discover";
  const isRecentAddedView = activeNavSection === "recent-added";
  const isAlbumsView = activeNavSection === "albums";
  const isArtistsView = activeNavSection === "artists";
  const isSongsView = activeNavSection === "songs";
  const isAlbumCollectionView = isDiscoverView || isRecentAddedView || isAlbumsView;
  const discoverFeaturedAlbum = discoverRecentAlbums[0] ?? null;
  const discoverFeaturedCoverUrl = discoverFeaturedAlbum
    ? getAlbumCoverUrl(discoverFeaturedAlbum.coverArt, 512)
    : null;
  const discoverFeaturedMeta = discoverFeaturedAlbum
    ? getAlbumSecondaryMeta(discoverFeaturedAlbum)
    : "";
  const isLibraryView = !isPlaylistsView && !isSearchView;
  const canGoBack = navHistory.index > 0;
  const canGoForward = navHistory.index < navHistory.stack.length - 1;

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
      const nextSection = prev.stack[nextIndex] ?? "discover";
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
      const nextSection = prev.stack[nextIndex] ?? "discover";
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
        handleNavigateSection("discover");
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

  const handleBackToAlbums = () => {
    handleNavigateSection("albums");
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

        <div className="relative z-10 flex h-full min-h-0 pb-24 pt-14">
          <Sidebar
            onNavigateSection={handleNavigateSection}
            onOpenSettings={handleOpenSettingsPanel}
          />

          <main ref={mainRef} className="relative h-full min-h-0 flex-1 overflow-y-auto p-6 sm:p-8 scrollbar-thin">
            <div className="flex flex-col gap-8 pb-12">
        <section className="flex items-center justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-slate-500 dark:text-slate-300">
              <Disc3 className="h-4 w-4" />
              <span className="text-xs uppercase tracking-[0.2em]">Library</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{viewTitleMap[activeNavSection]}</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {viewDescriptionMap[activeNavSection]}
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
          <Card>
            <CardHeader>
              <CardTitle className="text-base">播放列表</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-600 dark:text-slate-300">
              播放列表功能即将完善，当前可先从“专辑”或“最近播放”中直接点歌播放。
            </CardContent>
          </Card>
        )}

        {isSearchView && (
          <>
            <section>
              <div className="mb-3 flex items-center gap-2">
                <Disc3 className="h-4 w-4 text-slate-500" />
                <h2 className="text-sm font-medium">
                  搜索结果 · {normalizedSearchKeyword || "请输入关键词"}
                </h2>
              </div>

              {globalSearchError && (
                <Card className="mb-4 border-rose-200 bg-rose-50 dark:border-rose-900/40 dark:bg-rose-900/20">
                  <CardContent className="pt-4 text-sm text-slate-700 dark:text-slate-200">
                    {globalSearchErrorObj instanceof Error
                      ? globalSearchErrorObj.message
                      : "搜索失败"}
                  </CardContent>
                </Card>
              )}

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">匹配专辑 ({globalSearchAlbums.length})</CardTitle>
                  </CardHeader>
                  <CardContent className="p-3">
                    {globalSearchLoading ? (
                      <div className="flex h-24 items-center justify-center gap-2 text-sm text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        搜索中...
                      </div>
                    ) : globalSearchAlbums.length > 0 ? (
                      <div className="grid grid-cols-2 gap-3">
                        {globalSearchAlbums.map((album) => {
                          const coverUrl =
                            album.coverArt && client
                              ? client.getCoverArtUrl(album.coverArt, 256)
                              : null;

                          return (
                            <button
                              key={album.id}
                              type="button"
                              onClick={() => handleOpenAlbumDetail(album.id)}
                              className="overflow-hidden rounded-lg border border-slate-200 bg-white text-left transition-colors hover:border-emerald-400 dark:border-slate-800 dark:bg-slate-900"
                            >
                              <div className="aspect-square overflow-hidden border-b border-slate-200 dark:border-slate-800">
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
                              <div className="p-3">
                                <p className="truncate text-sm font-medium">{album.name}</p>
                                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                                  {album.artist ?? "Unknown Artist"}
                                </p>
                              </div>
                            </button>
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
                  <CardHeader>
                    <CardTitle className="text-base">匹配歌曲 ({globalSearchSongs.length})</CardTitle>
                  </CardHeader>
                  <CardContent className="p-3">
                    {globalSearchLoading ? (
                      <div className="flex h-24 items-center justify-center gap-2 text-sm text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        搜索中...
                      </div>
                    ) : globalSearchSongs.length > 0 ? (
                      <div className="space-y-1 pr-1">
                        {globalSearchSongs.map((song, index) => (
                          <SongListItem
                            key={song.id}
                            id={song.id}
                            index={index}
                            title={song.title}
                            artist={song.artist ?? "Unknown Artist"}
                            duration={formatTime(song.duration ?? 0)}
                            isPlaying={currentTrackId === song.id}
                            onClick={handlePlayGlobalSearchSong}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="flex h-24 items-center justify-center text-sm text-slate-500">
                        没有匹配到歌曲
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </section>
          </>
        )}

        {isLibraryView && (
          <>
            {isAlbumCollectionView && !isAlbumDetailView && (
              <section className="space-y-5">
                {isDiscoverView && (
                  <>
                    <Card className="overflow-hidden border-emerald-200/70 bg-[linear-gradient(135deg,rgba(16,185,129,0.16)_0%,rgba(59,130,246,0.1)_55%,rgba(15,23,42,0.03)_100%)] dark:border-emerald-900/40 dark:bg-[linear-gradient(135deg,rgba(5,46,22,0.55)_0%,rgba(17,24,39,0.45)_100%)]">
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
                                <p className="mb-2 inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-1 text-[0.68rem] font-medium uppercase tracking-[0.16em] text-emerald-700 dark:bg-slate-900/55 dark:text-emerald-300">
                                  推荐位
                                </p>
                                <h3 className="truncate text-xl font-semibold tracking-tight">
                                  {discoverFeaturedAlbum.title}
                                </h3>
                                <p className="mt-1 truncate text-sm text-slate-600 dark:text-slate-300">
                                  {discoverFeaturedAlbum.artist}
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
                          key: "recent",
                          icon: Clock3,
                          title: "最近添加",
                          description: "按时间排序，快速进入刚同步到库里的专辑。",
                          albums: discoverRecentAlbums,
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
                                    <button
                                      key={`${section.key}-${album.id}`}
                                      type="button"
                                      onClick={() => handleOpenAlbumDetail(album.id)}
                                      className="w-40 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white text-left transition-colors hover:border-emerald-400/70 dark:border-slate-800 dark:bg-slate-900"
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
                                      <div className="p-3">
                                        <p className="truncate text-sm font-medium">{album.title}</p>
                                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{album.artist}</p>
                                        {albumMeta ? (
                                          <p className="mt-1 truncate text-[0.68rem] text-slate-500 dark:text-slate-400">
                                            {albumMeta}
                                          </p>
                                        ) : null}
                                      </div>
                                    </button>
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
                      {isDiscoverView ? "全部专辑" : isRecentAddedView ? "最近播放专辑" : "专辑列表"}
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
                        <div
                          className="pr-1"
                        >
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
                                />
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="flex h-24 items-center justify-center rounded-lg text-sm text-slate-500">
                          没有匹配到专辑
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
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
                              <p className="truncate text-sm font-medium">{artist.artist}</p>
                              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                                {artist.albumCount} 张专辑 · {artist.songCount} 首歌曲
                                {artist.latestYear ? ` · 最近 ${artist.latestYear}` : ""}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setSearchInput(artist.artist);
                                setSearchKeyword(artist.artist);
                                handleNavigateSection("search");
                              }}
                            >
                              搜索作品
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

            {isSongsView && (
              <section className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <Music2 className="h-4 w-4 text-slate-500" />
                    <h2 className="text-sm font-medium">歌曲列表</h2>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={selectedAlbumId ?? ""}
                      onChange={(event) => setSelectedAlbumId(event.target.value || null)}
                      className="h-9 min-w-[220px] rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition-colors focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900"
                    >
                      {albumCards.map((album) => (
                        <option key={`song-view-${album.id}`} value={album.id}>
                          {album.title} · {album.artist}
                        </option>
                      ))}
                    </select>
                    <Button size="sm" onClick={handlePlayAlbumAll} disabled={visibleSongs.length === 0}>
                      播放全部
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleShuffleAlbum}
                      disabled={visibleSongs.length === 0}
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
                          {filteredSongs.map((song, index) => (
                            <SongListItem
                              key={`songs-view-${song.id}`}
                              id={song.id}
                              index={index}
                              title={song.title}
                              artist={song.artist ?? "Unknown Artist"}
                              duration={formatTime(song.duration ?? 0)}
                              isPlaying={currentTrackId === song.id}
                              onClick={handlePlaySong}
                            />
                          ))}
                        </>
                      ) : (
                        <div className="flex h-24 items-center justify-center rounded-lg text-sm text-slate-500">
                          当前专辑没有可显示歌曲
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </section>
            )}

            {isAlbumDetailView && (
              <>
                <section>
                  <div className="mb-3 flex items-center gap-3">
                    <Button variant="outline" size="sm" onClick={handleBackToAlbums}>
                      <ArrowLeft className="h-4 w-4" />
                      返回专辑列表
                    </Button>
                    {selectedAlbum && (
                      <h2 className="text-sm font-medium text-slate-600 dark:text-slate-300">
                        {selectedAlbum.artist}
                      </h2>
                    )}
                  </div>

                  <Card className="relative overflow-hidden border-slate-200/90 dark:border-slate-800/90">
                    {selectedCoverUrl ? (
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-25 blur-2xl saturate-150"
                        style={{ backgroundImage: `url(${selectedCoverUrl})` }}
                      />
                    ) : null}
                    <CardContent className="relative p-5 sm:p-6">
                      <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
                        {selectedCoverUrl ? (
                          <img
                            src={selectedCoverUrl}
                            alt={`${selectedAlbum?.title ?? "album"} cover`}
                            className="h-36 w-36 rounded-2xl border border-slate-200/80 object-cover shadow-lg dark:border-slate-800/80"
                          />
                        ) : (
                          <div className="h-36 w-36 rounded-2xl bg-[radial-gradient(circle_at_20%_20%,rgba(16,185,129,0.24),transparent_40%),radial-gradient(circle_at_80%_80%,rgba(59,130,246,0.2),transparent_42%)]" />
                        )}

                        <div className="min-w-0 flex-1">
                          <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-300">
                            Album
                          </p>
                          <p className="truncate text-2xl font-semibold tracking-tight">
                            {selectedAlbum?.title ?? "未选择专辑"}
                          </p>
                          <p className="mt-1 truncate text-sm text-slate-600 dark:text-slate-300">
                            {selectedAlbum?.artist ?? "Unknown Artist"}
                          </p>

                          <div className="mt-4 grid gap-2 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-2">
                            <p className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white/70 px-2.5 py-1.5 dark:border-slate-800/80 dark:bg-slate-900/70">
                              <CalendarDays className="h-3.5 w-3.5 text-slate-500" />
                              {selectedAlbum?.year ?? "未知年份"}
                            </p>
                            <p className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white/70 px-2.5 py-1.5 dark:border-slate-800/80 dark:bg-slate-900/70">
                              <Tags className="h-3.5 w-3.5 text-slate-500" />
                              {selectedAlbumGenre ?? "未知流派"}
                            </p>
                            <p className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white/70 px-2.5 py-1.5 dark:border-slate-800/80 dark:bg-slate-900/70">
                              <ListMusic className="h-3.5 w-3.5 text-slate-500" />
                              {selectedAlbumSongCount} 首
                            </p>
                            <p className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white/70 px-2.5 py-1.5 dark:border-slate-800/80 dark:bg-slate-900/70">
                              <Clock3 className="h-3.5 w-3.5 text-slate-500" />
                              {formatDuration(selectedAlbumDurationSeconds)}
                            </p>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
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
                    </CardContent>
                  </Card>
                </section>

                <section>
                  <div className="mb-3 flex items-center gap-2">
                    <ListMusic className="h-4 w-4 text-slate-500" />
                    <h2 className="text-sm font-medium">
                      歌曲列表{selectedAlbum ? ` · ${selectedAlbum.title}` : ""}
                    </h2>
                  </div>

                  <Card>
                    <CardContent className="p-2">
                      <div className="p-1">
                        {songsLoading ? (
                          Array.from({ length: 8 }).map((_, index) => (
                            <div
                              key={`song-skeleton-${index}`}
                              className="mb-1 h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800"
                            />
                          ))
                        ) : filteredSongs.length > 0 ? (
                          <>
                            {filteredSongs.map((song, index) => (
                              <SongListItem
                                key={song.id}
                                id={song.id}
                                index={index}
                                title={song.title}
                                artist={song.artist ?? "Unknown Artist"}
                                duration={formatTime(song.duration ?? 0)}
                                isPlaying={currentTrackId === song.id}
                                onClick={handlePlaySong}
                              />
                            ))}
                          </>
                        ) : (
                          <div className="flex h-24 items-center justify-center rounded-lg text-sm text-slate-500">
                            当前专辑没有可显示歌曲
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
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
          </div>
          </main>
        </div>

        <NowPlayingSheet
          open={isNowPlayingSheetOpen}
          currentTrack={currentTrack}
          queue={queue}
          isPlaying={isPlaying}
          lyrics={lyricsData}
          lyricsLoading={lyricsLoading}
          highResCoverUrl={nowPlayingHighResCoverUrl}
          onClose={handleCloseNowPlayingSheet}
          onSelectTrack={handleSelectQueueTrack}
        />

        <SettingsPanel open={isSettingsPanelOpen} onClose={handleCloseSettingsPanel} />

        <PlayerBar
          nowPlayingOpen={isNowPlayingSheetOpen}
          onOpenNowPlaying={handleOpenNowPlayingSheet}
          onToggleNowPlaying={handleToggleNowPlayingSheet}
        />
      </div>
    </div>
  );
}
