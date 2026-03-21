import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowLeft, Clock3, Disc3, ListMusic, Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { LoginPanel } from "@/features/auth/components/LoginPanel";
import { PlayerBar } from "@/components/layout/PlayerBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { WindowTitlebar } from "@/components/layout/WindowTitlebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { envDefaults } from "@/config/env";
import { useAlbumList } from "@/features/library/hooks/use-album-list";
import { useAlbumSongs } from "@/features/library/hooks/use-album-songs";
import { useGlobalSearch } from "@/features/library/hooks/use-global-search";
import { useLyrics } from "@/features/library/hooks/use-lyrics";
import { NowPlayingSheet } from "@/features/player/components/NowPlayingSheet";
import { mapSongToTrackInfo } from "@/features/player/utils/map-subsonic-song";
import { useDominantColor } from "@/hooks/use-dominant-color";
import { useMediaSession } from "@/hooks/use-media-session";
import { useTrayControls } from "@/hooks/use-tray-controls";
import { createSubsonicClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { type LibraryNavSection, useLibraryStore } from "@/stores/library-store";
import { usePlayerStore } from "@/stores/player-store";
import type { SubsonicAlbum } from "@/types/subsonic";

const ALBUM_SCROLL_HEIGHT = 560;
const ALBUM_ROW_HEIGHT = 258;
const ALBUM_OVERSCAN_ROWS = 2;
const SONG_SCROLL_HEIGHT = 360;
const SONG_ROW_HEIGHT = 56;
const SONG_OVERSCAN_ROWS = 8;

type AlbumCard = {
  id: string;
  title: string;
  artist: string;
  coverArt?: string;
  songCount?: number;
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
    coverArt: album.coverArt,
    songCount: album.songCount,
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
  const progress = usePlayerStore((state) => state.progress);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const setQueue = usePlayerStore((state) => state.setQueue);
  const setPlaying = usePlayerStore((state) => state.setPlaying);
  const playTrackById = usePlayerStore((state) => state.playTrackById);

  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );
  const [albumScrollTop, setAlbumScrollTop] = useState(0);
  const [songScrollTop, setSongScrollTop] = useState(0);
  const [isNowPlayingSheetOpen, setNowPlayingSheetOpen] = useState(false);
  const [isRefreshingLibrary, setRefreshingLibrary] = useState(false);
  const [searchInput, setSearchInput] = useState("");
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
  const {
    data: globalSearchData = { albums: [], songs: [] },
    isLoading: globalSearchLoading,
    isError: globalSearchError,
    error: globalSearchErrorObj,
  } = useGlobalSearch(client, sessionKey, normalizedSearchKeyword);
  const {
    data: suggestionSearchData = { albums: [], songs: [] },
  } = useGlobalSearch(client, sessionKey, normalizedSearchInput);

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
    setAlbumScrollTop(0);
  }, [searchKeyword, filteredAlbums.length, viewportWidth]);

  useEffect(() => {
    setSongScrollTop(0);
  }, [searchKeyword, selectedAlbumId, filteredSongs.length]);

  useEffect(() => {
    if (isAuthenticated) {
      return;
    }

    setSelectedAlbumId(null);
    setSearchInput("");
    setSearchKeyword("");
    setActiveNavSection("discover");
    setNowPlayingSheetOpen(false);
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
    setPlaying,
    setQueue,
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
    const keyword = normalizedSearchInput.toLowerCase();
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

  const dynamicGlow = useDominantColor(selectedCoverUrl);

  const getAlbumCoverUrl = (coverArt: string | undefined, size: number) =>
    coverArt && client ? client.getCoverArtUrl(coverArt, size) : null;

  const getAlbumSecondaryMeta = (album: AlbumCard) =>
    [album.songCount ? `${album.songCount} 首` : null, album.year ? `${album.year}` : null]
      .filter(Boolean)
      .join(" · ");

  const handlePlaySong = (songId: string) => {
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
  };

  const handlePlayGlobalSearchSong = (songId: string) => {
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
  };

  const albumColumns = useMemo(() => getAlbumColumns(viewportWidth), [viewportWidth]);
  const albumRowCount = Math.ceil(filteredAlbums.length / albumColumns);
  const albumStartRow = Math.max(
    0,
    Math.floor(albumScrollTop / ALBUM_ROW_HEIGHT) - ALBUM_OVERSCAN_ROWS,
  );
  const albumVisibleRows =
    Math.ceil(ALBUM_SCROLL_HEIGHT / ALBUM_ROW_HEIGHT) + ALBUM_OVERSCAN_ROWS * 2;
  const albumEndRow = Math.min(albumRowCount, albumStartRow + albumVisibleRows);
  const albumStartIndex = albumStartRow * albumColumns;
  const albumEndIndex = Math.min(filteredAlbums.length, albumEndRow * albumColumns);
  const virtualAlbums = filteredAlbums.slice(albumStartIndex, albumEndIndex);
  const albumTopPadding = albumStartRow * ALBUM_ROW_HEIGHT;
  const renderedAlbumRows = Math.ceil(virtualAlbums.length / albumColumns);
  const albumBottomPadding = Math.max(
    0,
    albumRowCount * ALBUM_ROW_HEIGHT - albumTopPadding - renderedAlbumRows * ALBUM_ROW_HEIGHT,
  );

  const songStartIndex = Math.max(
    0,
    Math.floor(songScrollTop / SONG_ROW_HEIGHT) - SONG_OVERSCAN_ROWS,
  );
  const songVisibleCount =
    Math.ceil(SONG_SCROLL_HEIGHT / SONG_ROW_HEIGHT) + SONG_OVERSCAN_ROWS * 2;
  const songEndIndex = Math.min(filteredSongs.length, songStartIndex + songVisibleCount);
  const virtualSongs = filteredSongs.slice(songStartIndex, songEndIndex);
  const songTopPadding = songStartIndex * SONG_ROW_HEIGHT;
  const songBottomPadding = Math.max(
    0,
    filteredSongs.length * SONG_ROW_HEIGHT - songTopPadding - virtualSongs.length * SONG_ROW_HEIGHT,
  );

  const lyricsTarget = currentTrack
    ? {
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
    "recent-added": "最近添加",
    albums: "专辑与歌曲",
    "album-detail": "专辑详情",
    search: "全局搜索",
    playlists: "播放列表",
  } as const;

  const viewDescriptionMap = {
    discover: "浏览你的音乐库与专辑，点击底部播放栏左侧封面可展开正在播放。",
    "recent-added": "按最近添加维度查看并播放你的音乐库内容。",
    albums: "专辑与歌曲列表均通过 TanStack Query 缓存；歌曲点选后直接进入播放队列。",
    "album-detail": "查看专辑内曲目并加入播放队列。",
    search: "跨全库搜索专辑与歌曲，结果来自 Subsonic search3。",
    playlists: "播放列表入口已接入，后续可扩展为真实列表管理。",
  } as const;

  const isPlaylistsView = activeNavSection === "playlists";
  const isSearchView = activeNavSection === "search";
  const isAlbumDetailView = activeNavSection === "album-detail";
  const isDiscoverView = activeNavSection === "discover";
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

  const handleOpenAlbumDetail = (albumId: string) => {
    setSelectedAlbumId(albumId);
    handleNavigateSection("album-detail");
  };

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
      <div className="relative h-screen w-full overflow-hidden bg-transparent p-2 text-slate-900 dark:text-slate-100">
        <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-100 px-6 dark:border-slate-800/80 dark:bg-slate-950">
          <WindowTitlebar />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.14),transparent_45%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.12),transparent_42%)]" />

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="relative z-10 w-full max-w-md pt-16"
          >
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
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-full overflow-hidden bg-transparent p-2 text-slate-900 dark:text-slate-100">
      <div className="relative h-full w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-100 dark:border-slate-800/80 dark:bg-slate-950">
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

        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.14),transparent_45%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.12),transparent_42%)]" />
        <motion.div
          aria-hidden
          animate={{ opacity: selectedCoverUrl ? 0.6 : 0.25 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(circle at 72% 28%, ${dynamicGlow}, transparent 44%)`,
          }}
        />

        <div className="relative z-10 flex h-full min-h-0 pb-24 pt-14">
          <Sidebar onNavigateSection={handleNavigateSection} />

          <main className="relative h-full min-h-0 flex-1 space-y-6 overflow-y-auto p-6 sm:p-8">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="flex items-center justify-between"
        >
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
        </motion.section>

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
              播放列表功能即将完善，当前可先从“专辑”或“最近添加”中直接点歌播放。
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
                      <div className="max-h-[520px] space-y-1 overflow-y-auto pr-1">
                        {globalSearchSongs.map((song, index) => (
                          <button
                            key={song.id}
                            type="button"
                            onClick={() => handlePlayGlobalSearchSong(song.id)}
                            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <div className="mr-3 min-w-0">
                              <p className="truncate text-sm font-medium">
                                {index + 1}. {song.title}
                              </p>
                              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                                {song.artist ?? "Unknown Artist"} · {song.album ?? "Unknown Album"}
                              </p>
                            </div>
                            <span className="text-xs text-slate-500">{formatTime(song.duration ?? 0)}</span>
                          </button>
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
            {!isAlbumDetailView && (
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
                                  <Sparkles className="h-3.5 w-3.5" />
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
                                {section.albums.map((album, index) => {
                                  const coverUrl = getAlbumCoverUrl(album.coverArt, 384);
                                  const albumMeta = getAlbumSecondaryMeta(album);

                                  return (
                                    <motion.button
                                      key={`${section.key}-${album.id}`}
                                      type="button"
                                      initial={{ opacity: 0, y: 8 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      transition={{ duration: 0.22, delay: Math.min(index, 10) * 0.02 }}
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
                                    </motion.button>
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
                    <h2 className="text-sm font-medium">{isDiscoverView ? "全部专辑" : "专辑列表"}</h2>
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
                      ) : filteredAlbums.length > 0 ? (
                        <div
                          className="max-h-[560px] overflow-y-auto pr-1"
                          onScroll={(event) => {
                            setAlbumScrollTop(event.currentTarget.scrollTop);
                          }}
                        >
                          <div style={{ height: albumTopPadding }} />

                          <div
                            className="grid gap-4"
                            style={{
                              gridTemplateColumns: `repeat(${albumColumns}, minmax(0, 1fr))`,
                            }}
                          >
                            {virtualAlbums.map((album, index) => {
                              const coverUrl = getAlbumCoverUrl(album.coverArt, 384);

                              return (
                                <motion.div
                                  key={album.id}
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ duration: 0.24, delay: Math.min(index, 10) * 0.02 }}
                                >
                                  <button
                                    type="button"
                                    onClick={() => handleOpenAlbumDetail(album.id)}
                                    className="w-full text-left"
                                  >
                                    <Card className="overflow-hidden transition-colors hover:border-emerald-400/70">
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

                                      <CardHeader>
                                        <CardTitle className="truncate text-base">{album.title}</CardTitle>
                                      </CardHeader>
                                      <CardContent>
                                        <p className="truncate text-sm text-slate-600 dark:text-slate-300">
                                          {album.artist}
                                        </p>
                                      </CardContent>
                                    </Card>
                                  </button>
                                </motion.div>
                              );
                            })}
                          </div>

                          <div style={{ height: albumBottomPadding }} />
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

                  <Card>
                    <CardContent className="flex items-center gap-4 p-4">
                      {selectedCoverUrl ? (
                        <img
                          src={selectedCoverUrl}
                          alt={`${selectedAlbum?.title ?? "album"} cover`}
                          className="h-20 w-20 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="h-20 w-20 rounded-lg bg-[radial-gradient(circle_at_20%_20%,rgba(16,185,129,0.24),transparent_40%),radial-gradient(circle_at_80%_80%,rgba(59,130,246,0.2),transparent_42%)]" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-xl font-semibold">
                          {selectedAlbum?.title ?? "未选择专辑"}
                        </p>
                        <p className="truncate text-sm text-slate-600 dark:text-slate-300">
                          {selectedAlbum?.artist ?? "Unknown Artist"}
                        </p>
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
                      <div
                        className="max-h-[480px] overflow-y-auto p-1"
                        onScroll={(event) => {
                          setSongScrollTop(event.currentTarget.scrollTop);
                        }}
                      >
                        {songsLoading ? (
                          Array.from({ length: 8 }).map((_, index) => (
                            <div
                              key={`song-skeleton-${index}`}
                              className="mb-1 h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800"
                            />
                          ))
                        ) : filteredSongs.length > 0 ? (
                          <>
                            <div style={{ height: songTopPadding }} />

                            {virtualSongs.map((song, index) => {
                              const actualIndex = songStartIndex + index;
                              const playing = currentTrackId === song.id;

                              return (
                                <button
                                  key={song.id}
                                  type="button"
                                  onClick={() => handlePlaySong(song.id)}
                                  className={cn(
                                    "mb-1 flex h-12 w-full items-center justify-between rounded-lg px-3 text-left transition-colors",
                                    "hover:bg-slate-100 dark:hover:bg-slate-800",
                                    playing && "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/35 dark:text-emerald-300",
                                  )}
                                >
                                  <div className="mr-3 flex min-w-0 items-center gap-3">
                                    <span className="w-5 text-xs text-slate-500">{actualIndex + 1}</span>
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-medium">{song.title}</p>
                                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                                        {song.artist ?? "Unknown Artist"}
                                      </p>
                                    </div>
                                  </div>

                                  <span className="text-xs text-slate-500">{formatTime(song.duration ?? 0)}</span>
                                </button>
                              );
                            })}

                            <div style={{ height: songBottomPadding }} />
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
          </main>
        </div>

        <NowPlayingSheet
          open={isNowPlayingSheetOpen}
          currentTrack={currentTrack}
          queue={queue}
          progress={progress}
          isPlaying={isPlaying}
          lyrics={lyricsData}
          lyricsLoading={lyricsLoading}
          highResCoverUrl={nowPlayingHighResCoverUrl}
          onClose={handleCloseNowPlayingSheet}
          onSelectTrack={handleSelectQueueTrack}
        />

        <PlayerBar
          nowPlayingOpen={isNowPlayingSheetOpen}
          onOpenNowPlaying={handleOpenNowPlayingSheet}
          onToggleNowPlaying={handleToggleNowPlayingSheet}
        />
      </div>
    </div>
  );
}
