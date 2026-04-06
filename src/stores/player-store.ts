import { create } from "zustand";

type RepeatMode = "off" | "all" | "one";

export type TrackInfo = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  albumId?: string;
  duration: number;
  streamUrl?: string;
  coverArtId?: string;
  coverUrl?: string;
  trackGainDb?: number;
  albumGainDb?: number;
  bitRate?: number;
  bitDepth?: number;
  sampleRate?: number;
  suffix?: string;
};

type PlayerState = {
  currentTrack: TrackInfo | null;
  queue: TrackInfo[];
  currentIndex: number;
  isPlaying: boolean;
  volume: number;
  progress: number;
  repeatMode: RepeatMode;
  shuffle: boolean;
  shuffleHistory: string[];
  setCurrentTrack: (track: TrackInfo | null) => void;
  setQueue: (queue: TrackInfo[], startIndex?: number) => void;
  playTrackById: (trackId: string) => void;
  playNext: () => boolean;
  playPrevious: () => boolean;
  setPlaying: (isPlaying: boolean) => void;
  setVolume: (value: number) => void;
  setProgress: (value: number) => void;
  setRepeatMode: (mode: RepeatMode) => void;
  toggleShuffle: () => void;
};

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
  queue: [],
  currentIndex: -1,
  isPlaying: false,
  volume: 0.75,
  progress: 0,
  repeatMode: "off",
  shuffle: false,
  shuffleHistory: [],
  setCurrentTrack: (currentTrack) =>
    set((state) => {
      if (!currentTrack) {
        return {
          currentTrack: null,
          currentIndex: -1,
          progress: 0,
          shuffleHistory: [],
        };
      }

      const queueIndex = state.queue.findIndex((track) => track.id === currentTrack.id);
      return {
        currentTrack,
        currentIndex: queueIndex,
        progress: 0,
        shuffleHistory: [currentTrack.id],
      };
    }),
  setQueue: (queue, startIndex = 0) =>
    set(() => {
      const safeIndex = queue.length === 0
        ? -1
        : Math.max(0, Math.min(startIndex, queue.length - 1));
      const currentTrack = safeIndex >= 0 ? queue[safeIndex] ?? null : null;
      return {
        queue,
        currentIndex: safeIndex,
        currentTrack,
        progress: 0,
        shuffleHistory: currentTrack ? [currentTrack.id] : [],
      };
    }),
  playTrackById: (trackId) =>
    set((state) => {
      const nextIndex = state.queue.findIndex((track) => track.id === trackId);
      if (nextIndex < 0) {
        return state;
      }

      return {
        currentTrack: state.queue[nextIndex] ?? null,
        currentIndex: nextIndex,
        progress: 0,
        shuffleHistory: [trackId],
      };
    }),
  playNext: () => {
    const state = get();
    const {
      queue,
      currentIndex,
      shuffle,
      repeatMode,
      currentTrack,
      shuffleHistory,
    } = state;

    if (queue.length === 0) {
      return false;
    }

    let nextIndex = currentIndex;
    let nextHistory = shuffleHistory;

    if (shuffle && queue.length > 1) {
      const currentId = currentTrack?.id;
      const baseHistory = currentId
        ? Array.from(new Set([...shuffleHistory, currentId]))
        : Array.from(new Set(shuffleHistory));
      const visited = new Set(baseHistory);

      let candidates = queue
        .map((track, index) => ({ track, index }))
        .filter((item) => !visited.has(item.track.id));

      if (candidates.length === 0) {
        if (repeatMode !== "all") {
          return false;
        }

        const resetVisited = currentId ? new Set([currentId]) : new Set<string>();
        candidates = queue
          .map((track, index) => ({ track, index }))
          .filter((item) => !resetVisited.has(item.track.id));
        nextHistory = currentId ? [currentId] : [];
      } else {
        nextHistory = baseHistory;
      }

      if (candidates.length === 0) {
        return false;
      }

      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      nextIndex = pick?.index ?? -1;
    } else {
      const atEnd = currentIndex >= queue.length - 1;
      if (atEnd) {
        if (repeatMode === "all") {
          nextIndex = 0;
        } else {
          return false;
        }
      } else if (currentIndex < 0) {
        nextIndex = 0;
      } else {
        nextIndex = currentIndex + 1;
      }
    }

    if (nextIndex < 0) {
      return false;
    }

    const nextTrack = queue[nextIndex] ?? null;

    set({
      currentIndex: nextIndex,
      currentTrack: nextTrack,
      progress: 0,
      shuffleHistory: nextTrack
        ? shuffle
          ? Array.from(new Set([...nextHistory, nextTrack.id]))
          : [nextTrack.id]
        : [],
    });
    return true;
  },
  playPrevious: () => {
    const state = get();
    const { queue, currentIndex, repeatMode, shuffle, shuffleHistory } = state;

    if (queue.length === 0) {
      return false;
    }

    if (shuffle && shuffleHistory.length > 1) {
      const previousTrackId = shuffleHistory[shuffleHistory.length - 2];
      const previousIndex = queue.findIndex((track) => track.id === previousTrackId);
      if (previousIndex < 0) {
        return false;
      }

      set({
        currentIndex: previousIndex,
        currentTrack: queue[previousIndex] ?? null,
        progress: 0,
        shuffleHistory: shuffleHistory.slice(0, -1),
      });
      return true;
    }

    let nextIndex = currentIndex;
    if (currentIndex <= 0) {
      if (repeatMode === "all") {
        nextIndex = queue.length - 1;
      } else {
        return false;
      }
    } else {
      nextIndex = currentIndex - 1;
    }

    set({
      currentIndex: nextIndex,
      currentTrack: queue[nextIndex] ?? null,
      progress: 0,
      shuffleHistory: queue[nextIndex] ? [queue[nextIndex].id] : [],
    });
    return true;
  },
  setPlaying: (isPlaying) => set({ isPlaying }),
  setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),
  setProgress: (progress) => set({ progress: Math.max(0, progress) }),
  setRepeatMode: (repeatMode) => set({ repeatMode }),
  toggleShuffle: () =>
    set((state) => {
      const nextShuffle = !state.shuffle;
      return {
        shuffle: nextShuffle,
        shuffleHistory: nextShuffle && state.currentTrack ? [state.currentTrack.id] : [],
      };
    }),
}));
