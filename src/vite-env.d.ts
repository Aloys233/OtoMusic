/// <reference types="vite/client" />

interface ElectronBridge {
  sendWindowControl(channel: "window-min" | "window-max" | "window-close" | "window-show"): void;
  moveWindowBy(dx: number, dy: number): void;
  onTrayAction(handler: (action: "show" | "play-pause" | "next" | "previous") => void): () => void;
  updateGlobalShortcuts(config: {
    enabled: boolean;
    playPause: string;
    nextTrack: string;
    previousTrack: string;
  }): void;
}

declare global {
  interface Window {
    electron?: ElectronBridge;
  }

  const __APP_VERSION__: string;
}

declare module "react" {
  interface CSSProperties {
    WebkitAppRegion?: "drag" | "no-drag";
  }
}

export {};
