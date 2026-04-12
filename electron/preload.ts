import { contextBridge, ipcRenderer } from "electron";

type TrayAction = "show" | "play-pause" | "next" | "previous";
type WindowControlChannel = "window-min" | "window-max" | "window-close" | "window-show";
type GlobalShortcutConfig = {
  enabled: boolean;
  playPause: string;
  nextTrack: string;
  previousTrack: string;
};
type MpvPlayPayload = {
  url: string;
  startSeconds?: number;
  paused?: boolean;
  volume?: number;
  speed?: number;
};
type MpvPropertyName = "time-pos" | "duration" | "pause";
type SecureAuthSession = {
  baseUrl: string;
  username: string;
  password: string;
};

const electronBridge = {
  sendWindowControl(channel: WindowControlChannel) {
    ipcRenderer.send(channel);
  },
  moveWindowBy(dx: number, dy: number) {
    ipcRenderer.send("window-move-by", dx, dy);
  },
  onTrayAction(handler: (action: TrayAction) => void) {
    const listener = (_event: Electron.IpcRendererEvent, action: TrayAction) => {
      handler(action);
    };

    ipcRenderer.on("tray-action", listener);

    return () => {
      ipcRenderer.removeListener("tray-action", listener);
    };
  },
  updateGlobalShortcuts(config: GlobalShortcutConfig) {
    ipcRenderer.send("global-shortcuts:update", config);
  },
  async mpvIsAvailable() {
    return await ipcRenderer.invoke("mpv:is-available");
  },
  async mpvPlay(payload: MpvPlayPayload) {
    await ipcRenderer.invoke("mpv:play", payload);
  },
  async mpvPause() {
    await ipcRenderer.invoke("mpv:pause");
  },
  async mpvResume() {
    await ipcRenderer.invoke("mpv:resume");
  },
  async mpvStop() {
    await ipcRenderer.invoke("mpv:stop");
  },
  async mpvSeek(seconds: number) {
    await ipcRenderer.invoke("mpv:seek", seconds);
  },
  async mpvSetVolume(volume: number) {
    await ipcRenderer.invoke("mpv:set-volume", volume);
  },
  async mpvSetSpeed(speed: number) {
    await ipcRenderer.invoke("mpv:set-speed", speed);
  },
  async mpvGetTimePos() {
    return await ipcRenderer.invoke("mpv:get-time-pos");
  },
  async mpvGetDuration() {
    return await ipcRenderer.invoke("mpv:get-duration");
  },
  async loadSecureSession() {
    return await ipcRenderer.invoke("auth:load-secure-session") as SecureAuthSession | null;
  },
  async saveSecureSession(session: SecureAuthSession) {
    await ipcRenderer.invoke("auth:save-secure-session", session);
  },
  async clearSecureSession() {
    await ipcRenderer.invoke("auth:clear-secure-session");
  },
  onMpvEnded(handler: () => void) {
    const listener = () => {
      handler();
    };

    ipcRenderer.on("mpv-ended", listener);

    return () => {
      ipcRenderer.removeListener("mpv-ended", listener);
    };
  },
  onMpvProperty(handler: (name: MpvPropertyName, value: unknown) => void) {
    const listener = (_event: Electron.IpcRendererEvent, payload: { name: MpvPropertyName; value: unknown }) => {
      handler(payload.name, payload.value);
    };

    ipcRenderer.on("mpv-property", listener);

    return () => {
      ipcRenderer.removeListener("mpv-property", listener);
    };
  },
};

contextBridge.exposeInMainWorld("electron", electronBridge);
