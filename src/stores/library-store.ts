import { create } from "zustand";

export type LibraryNavSection =
  | "discover"
  | "recent-added"
  | "albums"
  | "artists"
  | "songs"
  | "album-detail"
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
  activeNavSection: "discover",
  setSelectedAlbumId: (selectedAlbumId) => set({ selectedAlbumId }),
  setSearchKeyword: (searchKeyword) => set({ searchKeyword }),
  setActiveNavSection: (activeNavSection) => set({ activeNavSection }),
}));
