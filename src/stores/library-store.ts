import { create } from "zustand";

export type LibraryNavSection =
  | "for-you"
  | "discover"
  | "recent-added"
  | "albums"
  | "artists"
  | "songs"
  | "loved-tracks"
  | "genres"
  | "folders"
  | "album-detail"
  | "playlist-detail"
  | "artist-detail"
  | "search"
  | "playlists";

type LibraryState = {
  selectedAlbumId: string | null;
  searchKeyword: string;
  activeNavSection: LibraryNavSection;
  setSelectedAlbumId: (albumId: string | null) => void;
  setSearchKeyword: (keyword: string) => void;
  setActiveNavSection: (section: LibraryNavSection) => void;
};

export const useLibraryStore = create<LibraryState>((set) => ({
  selectedAlbumId: null,
  searchKeyword: "",
  activeNavSection: "for-you",
  setSelectedAlbumId: (selectedAlbumId) => set({ selectedAlbumId }),
  setSearchKeyword: (searchKeyword) => set({ searchKeyword }),
  setActiveNavSection: (activeNavSection) => set({ activeNavSection }),
}));
