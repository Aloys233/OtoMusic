import { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, safeStorage } from "electron";
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
type SecureAuthSession = {
  baseUrl: string;
  username: string;
  password: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const rendererHtmlPath = path.resolve(__dirname, "../dist/index.html");
const preloadPath = path.resolve(__dirname, "./preload.mjs");

function getSecureCredentialsPath() {
  return path.join(app.getPath("userData"), "secure-auth.json");
}

async function loadSecureCredentials(): Promise<SecureAuthSession | null> {
  const credentialsPath = getSecureCredentialsPath();
  if (!fs.existsSync(credentialsPath) || !safeStorage.isEncryptionAvailable()) {
    return null;
  }

  try {
    const raw = await fs.promises.readFile(credentialsPath, "utf8");
    const parsed = JSON.parse(raw) as { payload?: string };
    if (!parsed.payload) {
      return null;
    }

    const decrypted = safeStorage.decryptString(Buffer.from(parsed.payload, "base64"));
    const session = JSON.parse(decrypted) as Partial<SecureAuthSession>;
    if (!session.baseUrl || !session.username || !session.password) {
      return null;
    }

    return {
      baseUrl: session.baseUrl,
      username: session.username,
      password: session.password,
    };
  } catch (error) {
    console.warn("[OtoMusic] failed to load secure credentials", error);
    return null;
  }
}

async function saveSecureCredentials(session: SecureAuthSession) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("系统安全存储不可用，无法保存密码");
  }

  const credentialsPath = getSecureCredentialsPath();
  const encrypted = safeStorage.encryptString(JSON.stringify(session));
  await fs.promises.mkdir(path.dirname(credentialsPath), { recursive: true });
  await fs.promises.writeFile(
    credentialsPath,
    JSON.stringify({ payload: encrypted.toString("base64") }),
    "utf8",
  );
}

async function clearSecureCredentials() {
  try {
    await fs.promises.unlink(getSecureCredentialsPath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[OtoMusic] failed to clear secure credentials", error);
    }
  }
}

function applyV8MemoryLimit() {
  const maxOldSpaceMbRaw = process.env.OTOMUSIC_MAX_OLD_SPACE_MB;
  if (!maxOldSpaceMbRaw) {
    return;
  }

  const maxOldSpaceMb = Number.parseInt(maxOldSpaceMbRaw, 10);
  if (!Number.isFinite(maxOldSpaceMb) || maxOldSpaceMb < 256) {
    console.warn("[OtoMusic] invalid OTOMUSIC_MAX_OLD_SPACE_MB, expected integer >= 256");
    return;
  }

  app.commandLine.appendSwitch("js-flags", `--max-old-space-size=${Math.floor(maxOldSpaceMb)}`);
}

function resolveAppIconPath() {
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

  ipcMain.handle("auth:load-secure-session", async () => {
    return await loadSecureCredentials();
  });

  ipcMain.handle("auth:save-secure-session", async (_event, session: SecureAuthSession) => {
    await saveSecureCredentials(session);
  });

  ipcMain.handle("auth:clear-secure-session", async () => {
    await clearSecureCredentials();
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
    const trayIconPath = resolveAppIconPath();
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

  } catch (error) {
    tray = null;
    console.warn("[OtoMusic] failed to initialize tray", error);
  }
}

function createMainWindow() {
  const appIconPath = resolveAppIconPath();
  mainWindow = new BrowserWindow({
    title: "OtoMusic",
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    show: false,
    icon: appIconPath ?? undefined,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Hide to keep background playback alive when the tray is available.
  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }

    if (!tray) {
      isQuitting = true;
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
applyV8MemoryLimit();
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
