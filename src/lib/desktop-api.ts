export type TrayAction = "show" | "play-pause" | "next" | "previous";
export type WindowControlChannel = "window-min" | "window-max" | "window-close" | "window-show";

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
