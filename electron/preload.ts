import { contextBridge, ipcRenderer } from "electron";

type TrayAction = "show" | "play-pause" | "next" | "previous";
type WindowControlChannel = "window-min" | "window-max" | "window-close" | "window-show";
type GlobalShortcutConfig = {
  enabled: boolean;
  playPause: string;
  nextTrack: string;
  previousTrack: string;
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
};

contextBridge.exposeInMainWorld("electron", electronBridge);
