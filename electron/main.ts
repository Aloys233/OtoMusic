import { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MpvController } from "./mpv-controller";

type TrayAction = "show" | "play-pause" | "next" | "previous";
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const rendererHtmlPath = path.resolve(__dirname, "../dist/index.html");
const preloadPath = path.resolve(__dirname, "./preload.mjs");

function resolveTrayIconPath() {
  const candidates = [
    path.join(process.resourcesPath, "tray", "icon.png"),
    path.join(process.resourcesPath, "electron", "assets", "icon.png"),
    path.resolve(__dirname, "../electron/assets/icon.png"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const mpvController = new MpvController();
let globalShortcutConfig: GlobalShortcutConfig = {
  enabled: true,
  playPause: "MediaPlayPause",
  nextTrack: "MediaNextTrack",
  previousTrack: "MediaPreviousTrack",
};

function normalizeShortcutAccelerator(input: string) {
  if (input.length === 0) {
    return "";
  }

  if (/^\s+$/.test(input)) {
    return "Space";
  }

  const trimmed = input.trim();
  if (/^space(bar)?$/i.test(trimmed)) {
    return "Space";
  }

  return trimmed;
}

function emitTrayAction(action: TrayAction) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("tray-action", action);
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function setupIpc() {
  mpvController.setEventHandlers({
    onEnded: () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }
      mainWindow.webContents.send("mpv-ended");
    },
    onProperty: (name, value) => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }
      mainWindow.webContents.send("mpv-property", { name, value });
    },
  });

  ipcMain.on("window-min", () => {
    mainWindow?.minimize();
  });

  ipcMain.on("window-max", () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
      return;
    }

    mainWindow.maximize();
  });

  ipcMain.on("window-close", () => {
    mainWindow?.close();
  });

  ipcMain.on("window-show", () => {
    showMainWindow();
  });

  // Manual titlebar drag — renderer tracks mouse delta and sends it here
  ipcMain.on("window-move-by", (_, dx: number, dy: number) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    const [x, y] = mainWindow.getPosition();
    mainWindow.setPosition(x + dx, y + dy);
  });

  ipcMain.on("global-shortcuts:update", (_, nextConfig: Partial<GlobalShortcutConfig>) => {
    globalShortcutConfig = {
      enabled: Boolean(nextConfig.enabled),
      playPause: typeof nextConfig.playPause === "string"
        ? normalizeShortcutAccelerator(nextConfig.playPause)
        : "",
      nextTrack: typeof nextConfig.nextTrack === "string"
        ? normalizeShortcutAccelerator(nextConfig.nextTrack)
        : "",
      previousTrack: typeof nextConfig.previousTrack === "string"
        ? normalizeShortcutAccelerator(nextConfig.previousTrack)
        : "",
    };
    registerGlobalShortcuts();
  });

  ipcMain.handle("mpv:is-available", async () => {
    return await mpvController.isAvailable();
  });

  ipcMain.handle("mpv:play", async (_event, payload: MpvPlayPayload) => {
    await mpvController.play(payload);
  });

  ipcMain.handle("mpv:pause", async () => {
    await mpvController.pause();
  });

  ipcMain.handle("mpv:resume", async () => {
    await mpvController.resume();
  });

  ipcMain.handle("mpv:stop", async () => {
    await mpvController.stop();
  });

  ipcMain.handle("mpv:seek", async (_event, seconds: number) => {
    await mpvController.seek(seconds);
  });

  ipcMain.handle("mpv:set-volume", async (_event, volume: number) => {
    await mpvController.setVolume(volume);
  });

  ipcMain.handle("mpv:set-speed", async (_event, speed: number) => {
    await mpvController.setSpeed(speed);
  });

  ipcMain.handle("mpv:get-time-pos", async () => {
    return await mpvController.getTimePos();
  });

  ipcMain.handle("mpv:get-duration", async () => {
    return await mpvController.getDuration();
  });
}

function registerGlobalShortcuts() {
  globalShortcut.unregisterAll();

  if (!globalShortcutConfig.enabled) {
    return;
  }

  const registrations: Array<{ accelerator: string; action: TrayAction }> = [
    { accelerator: globalShortcutConfig.playPause, action: "play-pause" },
    { accelerator: globalShortcutConfig.nextTrack, action: "next" },
    { accelerator: globalShortcutConfig.previousTrack, action: "previous" },
  ];

  for (const registration of registrations) {
    if (!registration.accelerator) {
      continue;
    }

    const success = globalShortcut.register(registration.accelerator, () => {
      emitTrayAction(registration.action);
    });

    if (!success) {
      console.warn(`[OtoMusic] failed to register global shortcut: ${registration.accelerator}`);
    }
  }
}

function createTray() {
  try {
    const trayIconPath = resolveTrayIconPath();
    if (!trayIconPath) {
      console.warn("[OtoMusic] tray icon not found, tray disabled");
      return;
    }

    tray = new Tray(trayIconPath);
    tray.setToolTip("OtoMusic");

    const menu = Menu.buildFromTemplate([
      {
        label: "显示主窗口",
        click: () => {
          showMainWindow();
          emitTrayAction("show");
        },
      },
      {
        label: "播放 / 暂停",
        click: () => {
          emitTrayAction("play-pause");
        },
      },
      {
        label: "上一首",
        click: () => {
          emitTrayAction("previous");
        },
      },
      {
        label: "下一首",
        click: () => {
          emitTrayAction("next");
        },
      },
      { type: "separator" },
      {
        label: "退出 OtoMusic",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);

    tray.setContextMenu(menu);
    tray.on("click", () => {
      showMainWindow();
    });

    console.log("[OtoMusic] tray initialized");
  } catch (error) {
    tray = null;
    console.warn("[OtoMusic] failed to initialize tray", error);
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    title: "OtoMusic",
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Always hide instead of quit — background playback continues
  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
    return;
  }

  void mainWindow.loadFile(rendererHtmlPath);
}

// Single instance lock — re-launching the app shows the existing window
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });

  app.on("before-quit", () => {
    isQuitting = true;
    void mpvController.dispose();
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });

  app.whenReady().then(() => {
    setupIpc();
    createMainWindow();
    createTray();
    registerGlobalShortcuts();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
        return;
      }

      showMainWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
