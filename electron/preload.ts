import { contextBridge, ipcRenderer } from "electron";

type TrayAction = "show" | "play-pause" | "next" | "previous";
type WindowControlChannel = "window-min" | "window-max" | "window-close" | "window-show";

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
};

contextBridge.exposeInMainWorld("electron", electronBridge);
