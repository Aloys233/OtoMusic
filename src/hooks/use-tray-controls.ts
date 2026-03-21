import { useEffect } from "react";

import { listen } from "@tauri-apps/api/event";

import { audioEngine } from "@/lib/audio/AudioEngine";
import { usePlayerStore } from "@/stores/player-store";

const isTauriRuntime =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type TrayAction = "show" | "play-pause" | "next" | "previous";

export function useTrayControls() {
  useEffect(() => {
    if (!isTauriRuntime) {
      return;
    }

    let unlisten: (() => void) | undefined;

    void listen<TrayAction>("tray-action", async (event) => {
      const action = event.payload;
      const state = usePlayerStore.getState();

      if (action === "play-pause") {
        if (!state.currentTrack?.streamUrl) {
          return;
        }

        if (state.isPlaying) {
          await audioEngine.pause();
          usePlayerStore.getState().setPlaying(false);
          return;
        }

        usePlayerStore.getState().setPlaying(true);
        return;
      }

      if (action === "next") {
        const moved = usePlayerStore.getState().playNext();
        if (moved) {
          usePlayerStore.getState().setPlaying(true);
        }
        return;
      }

      if (action === "previous") {
        const moved = usePlayerStore.getState().playPrevious();
        if (moved) {
          usePlayerStore.getState().setPlaying(true);
        }
      }
    }).then((off) => {
      unlisten = off;
    });

    return () => {
      unlisten?.();
    };
  }, []);
}
