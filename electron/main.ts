import { app, BrowserWindow, Menu, Tray, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

type TrayAction = "show" | "play-pause" | "next" | "previous";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const rendererHtmlPath = path.resolve(__dirname, "../dist/index.html");
const preloadPath = path.resolve(__dirname, "./preload.mjs");
const trayIconPath = path.resolve(__dirname, "../electron/assets/icon.png");

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

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
}

function createTray() {
  try {
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

  app.whenReady().then(() => {
    setupIpc();
    createMainWindow();
    createTray();

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
