/// <reference types="vite/client" />

interface ElectronBridge {
  sendWindowControl(channel: "window-min" | "window-max" | "window-close" | "window-show"): void;
  moveWindowBy(dx: number, dy: number): void;
  onTrayAction(handler: (action: "show" | "play-pause" | "next" | "previous") => void): () => void;
}

declare global {
  interface Window {
    electron?: ElectronBridge;
  }
}

declare global {
  const __APP_VERSION__: string;
}

export {};
