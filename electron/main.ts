import { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type TrayAction = "show" | "play-pause" | "next" | "previous";
type GlobalShortcutConfig = {
  enabled: boolean;
  playPause: string;
  nextTrack: string;
  previousTrack: string;
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
