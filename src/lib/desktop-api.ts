export type TrayAction = "show" | "play-pause" | "next" | "previous";
export type WindowControlChannel = "window-min" | "window-max" | "window-close" | "window-show";
export type GlobalShortcutConfig = {
  enabled: boolean;
  playPause: string;
  nextTrack: string;
  previousTrack: string;
};
export type MpvPlayPayload = {
  url: string;
  startSeconds?: number;
  paused?: boolean;
  volume?: number;
  speed?: number;
};
export type MpvPropertyName = "time-pos" | "duration" | "pause";

export function isElectronRuntime() {
  if (typeof window === "undefined") {
    return false;
  }

  if (typeof window.electron !== "undefined") {
    return true;
  }

  // Fallback: detect Electron via user-agent even when preload fails to expose the bridge
  return typeof navigator !== "undefined" && navigator.userAgent.includes("Electron");
}

export function sendWindowControl(channel: WindowControlChannel) {
  window.electron?.sendWindowControl(channel);
}

export function moveWindowBy(dx: number, dy: number) {
  window.electron?.moveWindowBy(dx, dy);
}

export function listenTrayAction(handler: (action: TrayAction) => void) {
  if (!isElectronRuntime() || !window.electron) {
    return () => {};
  }

  return window.electron.onTrayAction(handler);
}

export function updateGlobalShortcuts(config: GlobalShortcutConfig) {
  if (!isElectronRuntime() || !window.electron) {
    return;
  }

  window.electron.updateGlobalShortcuts(config);
}

export async function isMpvAvailable() {
  if (!isElectronRuntime() || !window.electron) {
    return false;
  }

  return await window.electron.mpvIsAvailable();
}

export async function mpvPlay(payload: MpvPlayPayload) {
  if (!isElectronRuntime() || !window.electron) {
    return;
  }

  await window.electron.mpvPlay(payload);
}

export async function mpvPause() {
  if (!isElectronRuntime() || !window.electron) {
    return;
  }

  await window.electron.mpvPause();
}

export async function mpvResume() {
  if (!isElectronRuntime() || !window.electron) {
    return;
  }

  await window.electron.mpvResume();
}

export async function mpvStop() {
  if (!isElectronRuntime() || !window.electron) {
    return;
  }

  await window.electron.mpvStop();
}

export async function mpvSeek(seconds: number) {
  if (!isElectronRuntime() || !window.electron) {
    return;
  }

  await window.electron.mpvSeek(seconds);
}

export async function mpvSetVolume(volume: number) {
  if (!isElectronRuntime() || !window.electron) {
    return;
  }

  await window.electron.mpvSetVolume(volume);
}

export async function mpvSetSpeed(speed: number) {
  if (!isElectronRuntime() || !window.electron) {
    return;
  }

  await window.electron.mpvSetSpeed(speed);
}

export async function mpvGetTimePos() {
  if (!isElectronRuntime() || !window.electron) {
    return 0;
  }

  return await window.electron.mpvGetTimePos();
}

export async function mpvGetDuration() {
  if (!isElectronRuntime() || !window.electron) {
    return 0;
  }

  return await window.electron.mpvGetDuration();
}

export function listenMpvEnded(handler: () => void) {
  if (!isElectronRuntime() || !window.electron) {
    return () => {};
  }

  return window.electron.onMpvEnded(handler);
}

export function listenMpvProperty(handler: (name: MpvPropertyName, value: unknown) => void) {
  if (!isElectronRuntime() || !window.electron) {
    return () => {};
  }

  return window.electron.onMpvProperty(handler);
}
