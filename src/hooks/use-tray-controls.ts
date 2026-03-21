import { useEffect } from "react";

import { audioEngine } from "@/lib/audio/AudioEngine";
import { isElectronRuntime, listenTrayAction } from "@/lib/desktop-api";
import { usePlayerStore } from "@/stores/player-store";

export function useTrayControls() {
  useEffect(() => {
    if (!isElectronRuntime()) {
      return;
    }

    const unlisten = listenTrayAction(async (action) => {
      const state = usePlayerStore.getState();

      if (action === "show") {
        return;
      }

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
    });

    return () => {
      unlisten();
    };
  }, []);
}
