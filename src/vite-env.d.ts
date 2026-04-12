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
  mpvIsAvailable(): Promise<boolean>;
  mpvPlay(payload: {
    url: string;
    startSeconds?: number;
    paused?: boolean;
    volume?: number;
    speed?: number;
  }): Promise<void>;
  mpvPause(): Promise<void>;
  mpvResume(): Promise<void>;
  mpvStop(): Promise<void>;
  mpvSeek(seconds: number): Promise<void>;
  mpvSetVolume(volume: number): Promise<void>;
  mpvSetSpeed(speed: number): Promise<void>;
  mpvGetTimePos(): Promise<number>;
  mpvGetDuration(): Promise<number>;
  loadSecureSession(): Promise<{
    baseUrl: string;
    username: string;
    password: string;
  } | null>;
  saveSecureSession(session: {
    baseUrl: string;
    username: string;
    password: string;
  }): Promise<void>;
  clearSecureSession(): Promise<void>;
  onMpvEnded(handler: () => void): () => void;
  onMpvProperty(handler: (name: "time-pos" | "duration" | "pause", value: unknown) => void): () => void;
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
