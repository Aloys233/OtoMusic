import { AnimatePresence, motion } from "framer-motion";
import {
  CircleAlert,
  CircleCheckBig,
  Database,
  Download,
  Info,
  Laptop,
  LogOut,
  MoonStar,
  Palette,
  RefreshCw,
  ScanSearch,
  Server,
  Settings2,
  SunMedium,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { type CSSProperties, type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";

import { useCacheManager } from "@/hooks/use-cache-manager";
import type { UpdateCheckerResult } from "@/hooks/use-update-checker";
import { createSubsonicClient } from "@/lib/api/client";
import { audioEngine } from "@/lib/audio/AudioEngine";
import { isElectronRuntime, updateGlobalShortcuts } from "@/lib/desktop-api";
import { normalizeServerBaseUrl } from "@/lib/server-url";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import {
  EQ_BAND_FREQUENCIES,
  EQ_PRESETS,
  type EqualizerPreset,
  type ReplayGainMode,
  useSettingsStore,
} from "@/stores/settings-store";
import { type ThemeMode, useThemeStore } from "@/stores/theme-store";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Separator } from "../ui/separator";
import { Slider } from "../ui/slider";

type SettingsPanelProps = {
  open: boolean;
  onClose: () => void;
  updateChecker: UpdateCheckerResult;
};

const themeOptions: Array<{
  mode: ThemeMode;
  label: string;
  icon: typeof MoonStar;
}> = [
  { mode: "light", label: "浅色", icon: SunMedium },
  { mode: "dark", label: "深色", icon: MoonStar },
  { mode: "system", label: "跟随系统", icon: Laptop },
];

const streamQualityOptions = [
  { value: "original", label: "原始音质", description: "无转码" },
  { value: "320", label: "320 kbps", description: "高质量串流" },
  { value: "128", label: "128 kbps", description: "节省流量" },
] as const;

type SettingsTab = "appearance" | "audio" | "data" | "system" | "about";

const SETTINGS_TABS: Array<{
  id: SettingsTab;
  label: string;
  icon: typeof Palette;
}> = [
  { id: "appearance", label: "外观", icon: Palette },
  { id: "audio", label: "音频", icon: Volume2 },
  { id: "data", label: "数据", icon: Database },
  { id: "system", label: "系统", icon: Settings2 },
  { id: "about", label: "关于", icon: Info },
];

const replayGainOptions = [
  { value: "off" as const, label: "关闭", description: "不应用增益" },
  { value: "track" as const, label: "按曲目", description: "优先使用曲目增益" },
  { value: "album" as const, label: "按专辑", description: "优先使用专辑增益" },
];

function formatDeviceLabel(device: MediaDeviceInfo, index: number) {
  if (device.deviceId === "default") {
    return "系统默认输出";
  }

  const label = device.label.trim();
  return label || `音频输出 ${index + 1}`;
}

function formatEqFrequency(frequency: number) {
  if (frequency >= 1000) {
    const kilo = frequency / 1000;
    return Number.isInteger(kilo) ? `${kilo}k` : `${kilo.toFixed(1)}k`;
  }
  return `${frequency}`;
}

type ToggleRowProps = {
  label: string;
  description: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
};

function ToggleRow({ label, description, enabled, onChange, disabled = false }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/75 bg-white/70 px-3 py-2.5 dark:border-slate-800/75 dark:bg-slate-950/45">
      <div className="min-w-0">
        <p className="text-xs font-medium">{label}</p>
        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{description}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!enabled)}
        disabled={disabled}
        className={cn(
          "h-7 min-w-[52px] rounded-full border px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55",
          enabled
            ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]"
            : "border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
        )}
      >
        {enabled ? "开" : "关"}
      </button>
    </div>
  );
}

function isElectronAvailable() {
  return isElectronRuntime();
}

export function SettingsPanel({ open, onClose, updateChecker }: SettingsPanelProps) {
  const mode = useThemeStore((state) => state.mode);
  const resolvedMode = useThemeStore((state) => state.resolvedMode);
  const setMode = useThemeStore((state) => state.setMode);

  const outputDeviceId = useSettingsStore((state) => state.outputDeviceId);
  const audioPassthroughEnabled = useSettingsStore((state) => state.audioPassthroughEnabled);
  const preampGainDb = useSettingsStore((state) => state.preampGainDb);
  const gaplessPlaybackEnabled = useSettingsStore((state) => state.gaplessPlaybackEnabled);
  const crossfadeEnabled = useSettingsStore((state) => state.crossfadeEnabled);
  const crossfadeDurationSec = useSettingsStore((state) => state.crossfadeDurationSec);
  const equalizerEnabled = useSettingsStore((state) => state.equalizerEnabled);
  const equalizerBands = useSettingsStore((state) => state.equalizerBands);
  const equalizerPreset = useSettingsStore((state) => state.equalizerPreset);
  const streamQuality = useSettingsStore((state) => state.streamQuality);
  const accentColor = useSettingsStore((state) => state.accentColor);
  const accentSource = useSettingsStore((state) => state.accentSource);
  const lyricsFontScale = useSettingsStore((state) => state.lyricsFontScale);
  const lyricsAlign = useSettingsStore((state) => state.lyricsAlign);
  const showTranslatedLyrics = useSettingsStore((state) => state.showTranslatedLyrics);
  const showRomanizedLyrics = useSettingsStore((state) => state.showRomanizedLyrics);
  const nowPlayingBackgroundBlurEnabled = useSettingsStore(
    (state) => state.nowPlayingBackgroundBlurEnabled,
  );
  const maxCacheGb = useSettingsStore((state) => state.maxCacheGb);
  const globalShortcutsEnabled = useSettingsStore((state) => state.globalShortcutsEnabled);
  const playPauseShortcut = useSettingsStore((state) => state.playPauseShortcut);
  const nextTrackShortcut = useSettingsStore((state) => state.nextTrackShortcut);
  const previousTrackShortcut = useSettingsStore((state) => state.previousTrackShortcut);
  const scrobbleProvider = useSettingsStore((state) => state.scrobbleProvider);
  const lastFmApiKey = useSettingsStore((state) => state.lastFmApiKey);
  const lastFmApiSecret = useSettingsStore((state) => state.lastFmApiSecret);
  const lastFmSessionKey = useSettingsStore((state) => state.lastFmSessionKey);
  const listenBrainzToken = useSettingsStore((state) => state.listenBrainzToken);
  const desktopLyricsEnabled = useSettingsStore((state) => state.desktopLyricsEnabled);
  const replayGainMode = useSettingsStore((state) => state.replayGainMode);
  const playbackSpeed = useSettingsStore((state) => state.playbackSpeed);
  const fadeDurationSec = useSettingsStore((state) => state.fadeDurationSec);

  const setOutputDeviceId = useSettingsStore((state) => state.setOutputDeviceId);
  const setAudioPassthroughEnabled = useSettingsStore((state) => state.setAudioPassthroughEnabled);
  const setPreampGainDb = useSettingsStore((state) => state.setPreampGainDb);
  const setGaplessPlaybackEnabled = useSettingsStore((state) => state.setGaplessPlaybackEnabled);
  const setCrossfadeEnabled = useSettingsStore((state) => state.setCrossfadeEnabled);
  const setCrossfadeDurationSec = useSettingsStore((state) => state.setCrossfadeDurationSec);
  const setEqualizerEnabled = useSettingsStore((state) => state.setEqualizerEnabled);
  const setEqualizerBand = useSettingsStore((state) => state.setEqualizerBand);
  const setEqualizerPreset = useSettingsStore((state) => state.setEqualizerPreset);
  const resetEqualizer = useSettingsStore((state) => state.resetEqualizer);
  const setStreamQuality = useSettingsStore((state) => state.setStreamQuality);
  const setAccentColor = useSettingsStore((state) => state.setAccentColor);
  const setAccentSource = useSettingsStore((state) => state.setAccentSource);
  const setLyricsFontScale = useSettingsStore((state) => state.setLyricsFontScale);
  const setLyricsAlign = useSettingsStore((state) => state.setLyricsAlign);
  const setShowTranslatedLyrics = useSettingsStore((state) => state.setShowTranslatedLyrics);
  const setShowRomanizedLyrics = useSettingsStore((state) => state.setShowRomanizedLyrics);
  const setNowPlayingBackgroundBlurEnabled = useSettingsStore(
    (state) => state.setNowPlayingBackgroundBlurEnabled,
  );
  const setMaxCacheGb = useSettingsStore((state) => state.setMaxCacheGb);
  const setGlobalShortcutsEnabled = useSettingsStore((state) => state.setGlobalShortcutsEnabled);
  const setPlayPauseShortcut = useSettingsStore((state) => state.setPlayPauseShortcut);
  const setNextTrackShortcut = useSettingsStore((state) => state.setNextTrackShortcut);
  const setPreviousTrackShortcut = useSettingsStore((state) => state.setPreviousTrackShortcut);
  const setScrobbleProvider = useSettingsStore((state) => state.setScrobbleProvider);
  const setLastFmApiKey = useSettingsStore((state) => state.setLastFmApiKey);
  const setLastFmApiSecret = useSettingsStore((state) => state.setLastFmApiSecret);
  const setLastFmSessionKey = useSettingsStore((state) => state.setLastFmSessionKey);
  const setListenBrainzToken = useSettingsStore((state) => state.setListenBrainzToken);
  const setDesktopLyricsEnabled = useSettingsStore((state) => state.setDesktopLyricsEnabled);
  const setReplayGainMode = useSettingsStore((state) => state.setReplayGainMode);
  const setPlaybackSpeed = useSettingsStore((state) => state.setPlaybackSpeed);
  const setFadeDurationSec = useSettingsStore((state) => state.setFadeDurationSec);

  const session = useAuthStore((state) => state.session);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const serverConfig = useAuthStore((state) => state.serverConfig);
  const logout = useAuthStore((state) => state.logout);
  const saveServerConfig = useAuthStore((state) => state.saveServerConfig);
  const addFallbackUrl = useAuthStore((state) => state.addFallbackUrl);
  const removeFallbackUrl = useAuthStore((state) => state.removeFallbackUrl);
  const switchActiveUrl = useAuthStore((state) => state.switchActiveUrl);

  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [scanStatusText, setScanStatusText] = useState("尚未触发扫描");
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [fallbackDraft, setFallbackDraft] = useState("");
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const [switchingUrl, setSwitchingUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("appearance");

  const supportsOutputSelection = useMemo(() => audioEngine.supportsOutputDeviceSelection(), []);
  const isElectron = useMemo(() => isElectronAvailable(), []);
  const noDragRegionStyle: CSSProperties | undefined = isElectron
    ? { WebkitAppRegion: "no-drag" }
    : undefined;

  const scanClient = useMemo(() => {
    if (!session) {
      return null;
    }
    return createSubsonicClient(session);
  }, [session]);

  const cacheManager = useCacheManager();
  const cacheRefresh = cacheManager.refresh;
  const maxCacheBytes = maxCacheGb * 1024 ** 3;
  const isCacheOverLimit = cacheManager.usageBytes > maxCacheBytes;

  const serverHost = useMemo(() => {
    if (!session?.baseUrl) {
      return "未连接";
    }

    try {
      return new URL(session.baseUrl).host;
    } catch {
      return session.baseUrl;
    }
  }, [session?.baseUrl]);

  const refreshOutputDevices = useCallback(async () => {
    if (!supportsOutputSelection) {
      return;
    }

    setLoadingDevices(true);
    setDeviceError(null);
    try {
      const devices = await audioEngine.getOutputDevices();
      setOutputDevices(devices);
    } catch (error) {
      setOutputDevices([]);
      setDeviceError(error instanceof Error ? error.message : "无法读取输出设备列表");
    } finally {
      setLoadingDevices(false);
    }
  }, [supportsOutputSelection]);

  const refreshScanStatus = useCallback(async () => {
    if (!scanClient || !isAuthenticated) {
      setScanStatusText("未连接服务器");
      return;
    }

    try {
      const status = await scanClient.getScanStatus();
      if (status.scanning) {
        setScanStatusText(`正在扫描中，已处理 ${status.count} 个条目`);
      } else {
        setScanStatusText(`空闲，最近处理 ${status.count} 个条目`);
      }
      setScanError(null);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "读取扫描状态失败");
    }
  }, [isAuthenticated, scanClient]);

  useEffect(() => {
    void audioEngine.setPassthroughEnabled(audioPassthroughEnabled).catch(() => {
      // 忽略模式切换失败，避免设置面板交互中断。
    });
  }, [audioPassthroughEnabled]);

  useEffect(() => {
    audioEngine.setPreampGainDb(preampGainDb);
  }, [preampGainDb]);

  useEffect(() => {
    audioEngine.setGaplessEnabled(gaplessPlaybackEnabled);
  }, [gaplessPlaybackEnabled]);

  useEffect(() => {
    audioEngine.setCrossfadeEnabled(crossfadeEnabled);
  }, [crossfadeEnabled]);

  useEffect(() => {
    audioEngine.setCrossfadeDurationSec(crossfadeDurationSec);
  }, [crossfadeDurationSec]);

  useEffect(() => {
    audioEngine.setPlaybackRate(playbackSpeed);
  }, [playbackSpeed]);

  useEffect(() => {
    audioEngine.setFadeDuration(fadeDurationSec);
  }, [fadeDurationSec]);

  useEffect(() => {
    if (!open) {
      setActiveTab("appearance");
    }
  }, [open]);

  useEffect(() => {
    audioEngine.setEqualizerEnabled(equalizerEnabled);
  }, [equalizerEnabled]);

  useEffect(() => {
    audioEngine.setEqualizerBands(equalizerBands);
  }, [equalizerBands]);

  useEffect(() => {
    if (!supportsOutputSelection || !outputDeviceId) {
      return;
    }

    void audioEngine.setOutputDevice(outputDeviceId).catch(() => {
      // 忽略启动时设备恢复失败，用户可在设置中重新选择。
    });
  }, [outputDeviceId, supportsOutputSelection]);

  useEffect(() => {
    if (!open) {
      return;
    }

    void refreshOutputDevices();
    void refreshScanStatus();
    void cacheRefresh();
  }, [cacheRefresh, open, refreshOutputDevices, refreshScanStatus]);

  useEffect(() => {
    if (!open || !scanClient || !isAuthenticated) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshScanStatus();
    }, 4500);

    return () => {
      window.clearInterval(timer);
    };
  }, [isAuthenticated, open, refreshScanStatus, scanClient]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!isElectron) {
      return;
    }

    updateGlobalShortcuts({
      enabled: globalShortcutsEnabled,
      playPause: playPauseShortcut,
      nextTrack: nextTrackShortcut,
      previousTrack: previousTrackShortcut,
    });
  }, [
    globalShortcutsEnabled,
    isElectron,
    nextTrackShortcut,
    playPauseShortcut,
    previousTrackShortcut,
  ]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (session && !serverConfig) {
      saveServerConfig({
        name: "当前服务器",
        primaryUrl: session.baseUrl,
        fallbackUrls: [],
        username: session.username,
        password: session.password,
      });
    }
  }, [open, session, serverConfig, saveServerConfig]);

  const handleChangeOutputDevice = async (event: ChangeEvent<HTMLSelectElement>) => {
    const nextDeviceId = event.target.value;
    setOutputDeviceId(nextDeviceId);
    setDeviceError(null);

    if (!supportsOutputSelection) {
      return;
    }

    try {
      await audioEngine.setOutputDevice(nextDeviceId);
    } catch (error) {
      setDeviceError(error instanceof Error ? error.message : "切换输出设备失败");
    }
  };

  const handlePreampChange = (value: number[]) => {
    const nextGain = Number((value[0] ?? 0).toFixed(1));
    setPreampGainDb(nextGain);
    audioEngine.setPreampGainDb(nextGain);
  };

  const handleCrossfadeChange = (value: number[]) => {
    const nextSeconds = Math.max(1, Math.min(10, Math.round(value[0] ?? 3)));
    setCrossfadeDurationSec(nextSeconds);
  };

  const handleLyricsScaleChange = (value: number[]) => {
    const nextValue = Number((value[0] ?? 1).toFixed(2));
    setLyricsFontScale(nextValue);
  };

  const handleCacheLimitChange = (value: number[]) => {
    const nextValue = Number((value[0] ?? 1).toFixed(1));
    setMaxCacheGb(nextValue);
  };

  const handlePlaybackSpeedChange = (value: number[]) => {
    const next = Number((value[0] ?? 1).toFixed(2));
    setPlaybackSpeed(next);
  };

  const handleFadeDurationChange = (value: number[]) => {
    const next = Number((value[0] ?? 0.2).toFixed(2));
    setFadeDurationSec(next);
  };

  const handleAddFallbackUrl = () => {
    let normalizedUrl = "";
    try {
      normalizedUrl = normalizeServerBaseUrl(fallbackDraft);
    } catch (error) {
      setFallbackError(error instanceof Error ? error.message : "备用地址格式不正确");
      return;
    }
    if (serverConfig?.primaryUrl === normalizedUrl) {
      setFallbackError("备用地址不能与主地址相同");
      return;
    }
    if (serverConfig?.fallbackUrls.includes(normalizedUrl)) {
      setFallbackError("该备用地址已存在");
      return;
    }
    addFallbackUrl(normalizedUrl);
    setFallbackDraft("");
    setFallbackError(null);
  };

  const handleSwitchUrl = async (url: string) => {
    setSwitchingUrl(url);
    try {
      await switchActiveUrl(url);
    } finally {
      setSwitchingUrl(null);
    }
  };

  const handleStartServerScan = async () => {
    if (!scanClient || !isAuthenticated || scanLoading) {
      return;
    }

    setScanLoading(true);
    setScanError(null);
    try {
      const status = await scanClient.startScan();
      if (status.scanning) {
        setScanStatusText(`已触发扫描，当前处理 ${status.count} 个条目`);
      } else {
        setScanStatusText("扫描请求已发送，等待服务器响应");
      }
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "触发扫描失败");
    } finally {
      setScanLoading(false);
      void refreshScanStatus();
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[120]" style={noDragRegionStyle}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-[3px]"
          />

          <div className="absolute inset-0 flex items-center justify-center p-4 pb-24 pt-16 sm:p-8 sm:pb-24 sm:pt-20">
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label="settings-dialog"
              initial={{ opacity: 0, y: 18, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.985 }}
              transition={{ duration: 0.24, ease: "easeOut" }}
              className="flex h-[min(88vh,980px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-2xl backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/95"
              style={noDragRegionStyle}
            >
              <header className="flex items-center justify-between border-b border-slate-200/70 px-4 py-3 dark:border-slate-800/70">
                <div className="flex items-center gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Settings</p>
                    <h2 className="text-lg font-semibold">偏好设置</h2>
                  </div>
                  {updateChecker.hasUpdate === true && updateChecker.latestVersion ? (
                    <a
                      href={updateChecker.releaseUrl ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--accent-text)] transition-colors hover:opacity-85"
                    >
                      <Download className="h-3 w-3" />
                      v{updateChecker.latestVersion} 可用
                    </a>
                  ) : null}
                </div>
                <Button size="icon" variant="ghost" aria-label="close-settings" onClick={onClose}>
                  <X className="h-4 w-4" />
                </Button>
              </header>

              <nav className="flex gap-1 border-b border-slate-200/70 px-4 py-2 dark:border-slate-800/70">
                {SETTINGS_TABS.map((tab) => {
                  const active = activeTab === tab.id;
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                        active
                          ? "bg-[var(--accent-soft)] text-[var(--accent-text)]"
                          : "text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {tab.label}
                    </button>
                  );
                })}
              </nav>

              <div className="overflow-y-auto px-4 py-4">
                {activeTab === "appearance" && (
                <section className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 dark:border-slate-800/80 dark:bg-slate-900/70">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold">通用与外观</h3>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">主题、强调色、歌词展示</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {themeOptions.map((option) => {
                      const active = mode === option.mode;
                      const Icon = option.icon;

                      return (
                        <button
                          key={option.mode}
                          type="button"
                          onClick={() => setMode(option.mode)}
                          className={cn(
                            "rounded-xl border px-2.5 py-2 text-xs font-medium transition-colors",
                            active
                              ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]"
                              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600",
                          )}
                        >
                          <span className="mb-1 flex items-center justify-center">
                            <Icon className="h-4 w-4" />
                          </span>
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                    当前渲染主题：{resolvedMode === "dark" ? "深色" : "浅色"}
                  </p>

                  <Separator className="my-3" />

                  <ToggleRow
                    label="专辑封面自动取色"
                    description="启用后强调色跟随当前播放封面"
                    enabled={accentSource === "album"}
                    onChange={(enabled) => setAccentSource(enabled ? "album" : "manual")}
                  />

                  <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-3">
                    <div>
                      <p className="text-xs font-medium text-slate-600 dark:text-slate-300">手动强调色</p>
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        当前：{accentColor}
                      </p>
                    </div>
                    <input
                      type="color"
                      value={accentColor}
                      disabled={accentSource === "album"}
                      onChange={(event) => setAccentColor(event.target.value)}
                      className="h-9 w-14 cursor-pointer rounded-lg border border-slate-300 bg-transparent disabled:cursor-not-allowed disabled:opacity-45 dark:border-slate-700"
                    />
                  </div>

                  <Separator className="my-3" />

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-medium text-slate-600 dark:text-slate-300">歌词字体大小</p>
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs tabular-nums text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        {lyricsFontScale.toFixed(2)}x
                      </span>
                    </div>
                    <Slider value={[lyricsFontScale]} min={0.8} max={1.6} step={0.05} onValueChange={handleLyricsScaleChange} />
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setLyricsAlign("left")}
                      className={cn(
                        "rounded-xl border px-2 py-2 text-xs transition-colors",
                        lyricsAlign === "left"
                          ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]"
                          : "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300",
                      )}
                    >
                      左对齐
                    </button>
                    <button
                      type="button"
                      onClick={() => setLyricsAlign("center")}
                      className={cn(
                        "rounded-xl border px-2 py-2 text-xs transition-colors",
                        lyricsAlign === "center"
                          ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]"
                          : "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300",
                      )}
                    >
                      居中
                    </button>
                  </div>

                  <div className="mt-3 space-y-2">
                    <ToggleRow
                      label="显示翻译歌词"
                      description="隐藏显式翻译标记的行"
                      enabled={showTranslatedLyrics}
                      onChange={setShowTranslatedLyrics}
                    />
                    <ToggleRow
                      label="显示音译歌词"
                      description="隐藏疑似罗马音行"
                      enabled={showRomanizedLyrics}
                      onChange={setShowRomanizedLyrics}
                    />
                    <ToggleRow
                      label="播放页背景高斯模糊"
                      description="关闭可提升低端设备流畅度"
                      enabled={nowPlayingBackgroundBlurEnabled}
                      onChange={setNowPlayingBackgroundBlurEnabled}
                    />
                  </div>
                </section>
                )}

                {activeTab === "audio" && (
                <section className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 dark:border-slate-800/80 dark:bg-slate-900/70">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold">音频与播放</h3>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                        输出设备、EQ、无缝与淡入淡出
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="refresh-output-devices"
                      onClick={() => {
                        void refreshOutputDevices();
                      }}
                      disabled={!supportsOutputSelection || loadingDevices}
                    >
                      <RefreshCw className={cn("h-4 w-4", loadingDevices && "animate-spin")} />
                    </Button>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <p className="mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">音频输出设备</p>
                      {supportsOutputSelection ? (
                        <select
                          value={outputDeviceId}
                          onChange={(event) => {
                            void handleChangeOutputDevice(event);
                          }}
                          className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition-colors focus:border-[var(--accent-border)] dark:border-slate-700 dark:bg-slate-900"
                        >
                          <option value="default">系统默认输出</option>
                          {outputDevices
                            .filter((device) => device.deviceId !== "default")
                            .map((device, index) => (
                              <option key={device.deviceId} value={device.deviceId}>
                                {formatDeviceLabel(device, index)}
                              </option>
                            ))}
                        </select>
                      ) : (
                        <p className="rounded-xl border border-amber-200/80 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-200">
                          当前运行环境不支持切换音频输出设备。
                        </p>
                      )}
                    </div>

                    <ToggleRow
                      label="音频直通 (Bypass DSP)"
                      description="绕过 ReplayGain、播放增益和图形均衡器"
                      enabled={audioPassthroughEnabled}
                      onChange={setAudioPassthroughEnabled}
                    />

                    {audioPassthroughEnabled ? (
                      <p className="rounded-xl border border-sky-200/80 bg-sky-50 px-3 py-2 text-xs text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/35 dark:text-sky-200">
                        当前处于直通模式：下方 DSP 相关参数会被绕过。
                      </p>
                    ) : null}

                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-medium text-slate-600 dark:text-slate-300">播放增益</p>
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs tabular-nums text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          {preampGainDb > 0 ? "+" : ""}
                          {preampGainDb.toFixed(1)} dB
                        </span>
                      </div>

                      <Slider
                        value={[preampGainDb]}
                        min={-12}
                        max={12}
                        step={0.5}
                        onValueChange={handlePreampChange}
                        disabled={audioPassthroughEnabled}
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {streamQualityOptions.map((option) => {
                        const selected = streamQuality === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setStreamQuality(option.value)}
                            className={cn(
                              "rounded-xl border px-2 py-2 text-center text-xs transition-colors",
                              selected
                                ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]"
                                : "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300",
                            )}
                          >
                            <p className="font-medium">{option.label}</p>
                            <p className="mt-0.5 text-[10px] opacity-70">{option.description}</p>
                          </button>
                        );
                      })}
                    </div>

                    <div className="space-y-2">
                      <ToggleRow
                        label="无缝播放 (Gapless)"
                        description="曲间尽量减少停顿"
                        enabled={gaplessPlaybackEnabled}
                        onChange={setGaplessPlaybackEnabled}
                      />
                      <ToggleRow
                        label="淡入淡出 (Crossfade)"
                        description="切歌时使用平滑过渡"
                        enabled={crossfadeEnabled}
                        onChange={setCrossfadeEnabled}
                      />

                      {crossfadeEnabled ? (
                        <div>
                          <div className="mb-2 flex items-center justify-between">
                            <p className="text-xs font-medium text-slate-600 dark:text-slate-300">淡入淡出时长</p>
                            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs tabular-nums text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                              {crossfadeDurationSec}s
                            </span>
                          </div>
                          <Slider value={[crossfadeDurationSec]} min={1} max={10} step={1} onValueChange={handleCrossfadeChange} />
                        </div>
                      ) : null}
                    </div>

                    <Separator />

                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-medium text-slate-600 dark:text-slate-300">图形均衡器 (10 段)</p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={resetEqualizer}
                            disabled={audioPassthroughEnabled}
                            className="rounded-md px-1.5 py-0.5 text-[11px] transition-colors hover:bg-slate-200/80 disabled:cursor-not-allowed disabled:opacity-55 dark:hover:bg-slate-800"
                          >
                            重置
                          </button>
                          <button
                            type="button"
                            onClick={() => setEqualizerEnabled(!equalizerEnabled)}
                            disabled={audioPassthroughEnabled}
                            className={cn(
                              "h-7 min-w-[52px] rounded-full border px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55",
                              equalizerEnabled
                                ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]"
                                : "border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
                            )}
                          >
                            {equalizerEnabled ? "开启" : "关闭"}
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-5 gap-1.5">
                        {(Object.keys(EQ_PRESETS) as EqualizerPreset[]).map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setEqualizerPreset(preset)}
                            disabled={audioPassthroughEnabled}
                            className={cn(
                              "rounded-lg border px-1.5 py-1 text-[10px] uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-55",
                              equalizerPreset === preset
                                ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]"
                                : "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300",
                            )}
                          >
                            {preset}
                          </button>
                        ))}
                      </div>

                      <div className="mt-3 space-y-2">
                        {EQ_BAND_FREQUENCIES.map((frequency, index) => {
                          const bandValue = equalizerBands[index] ?? 0;
                          return (
                            <div key={frequency} className="grid grid-cols-[36px_1fr_52px] items-center gap-2">
                              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                {formatEqFrequency(frequency)}
                              </span>
                              <Slider
                                value={[bandValue]}
                                min={-12}
                                max={12}
                                step={0.5}
                                onValueChange={(value) => setEqualizerBand(index, value[0] ?? 0)}
                                disabled={audioPassthroughEnabled}
                              />
                              <span className="text-right text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                                {bandValue > 0 ? "+" : ""}
                                {bandValue.toFixed(1)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <Separator />

                    <div>
                      <p className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-300">响度均衡 (ReplayGain)</p>
                      <div className="grid grid-cols-3 gap-2">
                        {replayGainOptions.map((option) => {
                          const selected = replayGainMode === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => setReplayGainMode(option.value)}
                              disabled={audioPassthroughEnabled}
                              className={cn(
                                "rounded-xl border px-2 py-2 text-center text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-55",
                                selected
                                  ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]"
                                  : "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300",
                              )}
                            >
                              <p className="font-medium">{option.label}</p>
                              <p className="mt-0.5 text-[10px] opacity-70">{option.description}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-medium text-slate-600 dark:text-slate-300">播放速度</p>
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs tabular-nums text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          {playbackSpeed.toFixed(2)}x
                        </span>
                      </div>
                      <Slider value={[playbackSpeed]} min={0.5} max={2.0} step={0.05} onValueChange={handlePlaybackSpeedChange} />
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-medium text-slate-600 dark:text-slate-300">音频淡入淡出时长</p>
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs tabular-nums text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          {fadeDurationSec.toFixed(2)}s
                        </span>
                      </div>
                      <Slider value={[fadeDurationSec]} min={0.05} max={0.5} step={0.01} onValueChange={handleFadeDurationChange} />
                    </div>

                    {deviceError ? (
                      <p className="flex items-start gap-1.5 rounded-lg border border-rose-200/80 bg-rose-50 px-2.5 py-2 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
                        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {deviceError}
                      </p>
                    ) : null}
                  </div>
                </section>
                )}

                {activeTab === "data" && (
                <section className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 dark:border-slate-800/80 dark:bg-slate-900/70">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold">数据与服务器</h3>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">缓存管理、服务器地址、媒体库扫描</p>
                  </div>

                  <div className="space-y-3">
                    <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800/80 dark:bg-slate-950/35">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium">缓存占用</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{cacheManager.usageText}</p>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">最大缓存上限</p>
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs tabular-nums dark:bg-slate-800">
                          {maxCacheGb.toFixed(1)} GB
                        </span>
                      </div>
                      <div className="mt-2">
                        <Slider value={[maxCacheGb]} min={0.5} max={10} step={0.5} onValueChange={handleCacheLimitChange} />
                      </div>

                      {isCacheOverLimit ? (
                        <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-300">
                          当前缓存已超过上限，建议执行清理。
                        </p>
                      ) : null}

                      <Button
                        variant="outline"
                        className="mt-3 h-8 w-full justify-center text-xs"
                        onClick={() => {
                          void cacheManager.clearCaches();
                        }}
                        disabled={cacheManager.isClearing}
                      >
                        {cacheManager.isClearing ? (
                          <>
                            <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            清理中...
                          </>
                        ) : (
                          <>
                            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                            一键清除缓存
                          </>
                        )}
                      </Button>
                    </div>

                    <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800/80 dark:bg-slate-950/35">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ScanSearch className="h-4 w-4 text-slate-500" />
                          <p className="text-xs font-medium">同步与扫描</p>
                        </div>
                        <Button
                          size="sm"
                          className="h-8"
                          onClick={() => {
                            void handleStartServerScan();
                          }}
                          disabled={!isAuthenticated || scanLoading}
                        >
                          {scanLoading ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                          触发媒体库扫描
                        </Button>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">{scanStatusText}</p>
                      {scanError ? (
                        <p className="mt-2 text-[11px] text-rose-600 dark:text-rose-300">{scanError}</p>
                      ) : null}
                    </div>

                    <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800/80 dark:bg-slate-950/35">
                      <div className="mb-2 flex items-center gap-2">
                        <Server className="h-4 w-4 text-slate-500" />
                        <p className="text-xs font-medium">服务器地址</p>
                      </div>

                      {serverConfig ? (
                        <div className="space-y-2">
                          <div className="rounded-lg border border-slate-200 bg-white/80 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900/70">
                            <p className="text-xs font-medium">{serverConfig.name}</p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              {serverConfig.username}
                            </p>
                          </div>

                          <div className="space-y-1.5">
                            <p className="text-[11px] font-medium text-slate-600 dark:text-slate-300">地址列表</p>

                            <div
                              className={cn(
                                "flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5",
                                session?.baseUrl === serverConfig.primaryUrl
                                  ? "border-[var(--accent-border)] bg-[var(--accent-soft)]"
                                  : "border-slate-200 bg-white/80 dark:border-slate-700 dark:bg-slate-900/70",
                              )}
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="shrink-0 rounded bg-slate-200 px-1 py-0.5 text-[9px] font-medium dark:bg-slate-700">主</span>
                                  <p className="truncate text-[11px]">{serverConfig.primaryUrl}</p>
                                </div>
                              </div>
                              {session?.baseUrl !== serverConfig.primaryUrl ? (
                                <button
                                  type="button"
                                  onClick={() => { void handleSwitchUrl(serverConfig.primaryUrl); }}
                                  disabled={switchingUrl === serverConfig.primaryUrl}
                                  className="shrink-0 rounded-md border border-slate-300 px-2 py-0.5 text-[10px] transition-colors hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800"
                                >
                                  {switchingUrl === serverConfig.primaryUrl ? "切换中" : "切换"}
                                </button>
                              ) : (
                                <span className="shrink-0 text-[10px] text-[var(--accent-text)]">当前</span>
                              )}
                            </div>

                            {serverConfig.fallbackUrls.map((url) => (
                              <div
                                key={url}
                                className={cn(
                                  "flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5",
                                  session?.baseUrl === url
                                    ? "border-[var(--accent-border)] bg-[var(--accent-soft)]"
                                    : "border-slate-200 bg-white/80 dark:border-slate-700 dark:bg-slate-900/70",
                                )}
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="shrink-0 rounded bg-slate-100 px-1 py-0.5 text-[9px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">备</span>
                                    <p className="truncate text-[11px]">{url}</p>
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  {session?.baseUrl === url ? (
                                    <span className="text-[10px] text-[var(--accent-text)]">当前</span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => { void handleSwitchUrl(url); }}
                                      disabled={switchingUrl === url}
                                      className="rounded-md border border-slate-300 px-2 py-0.5 text-[10px] transition-colors hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800"
                                    >
                                      {switchingUrl === url ? "切换中" : "切换"}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => removeFallbackUrl(url)}
                                    className="rounded-md border border-rose-200 px-1.5 py-0.5 text-[10px] text-rose-600 transition-colors hover:bg-rose-50 dark:border-rose-900/70 dark:text-rose-300 dark:hover:bg-rose-950/35"
                                  >
                                    删除
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>

                          <div className="flex gap-2">
                            <Input
                              value={fallbackDraft}
                              placeholder="https://备用地址"
                              className="flex-1"
                              onChange={(event) => {
                                setFallbackDraft(event.target.value);
                                setFallbackError(null);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  handleAddFallbackUrl();
                                }
                              }}
                            />
                            <Button variant="outline" className="h-9 shrink-0 text-xs" onClick={handleAddFallbackUrl}>
                              添加备用
                            </Button>
                          </div>

                          {fallbackError ? (
                            <p className="text-[11px] text-rose-600 dark:text-rose-300">{fallbackError}</p>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          尚未配置服务器，请先登录
                        </p>
                      )}
                    </div>
                  </div>
                </section>
                )}

                {activeTab === "system" && (
                <section className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 dark:border-slate-800/80 dark:bg-slate-900/70">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold">系统与第三方集成</h3>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                      全局快捷键、Scrobble、桌面歌词开关
                    </p>
                  </div>

                  <div className="space-y-3">
                    <ToggleRow
                      label="启用全局快捷键"
                      description={isElectron ? "基于 Electron GlobalShortcut" : "仅桌面客户端可用"}
                      enabled={globalShortcutsEnabled}
                      onChange={setGlobalShortcutsEnabled}
                      disabled={!isElectron}
                    />

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <Input
                        value={playPauseShortcut}
                        disabled={!globalShortcutsEnabled || !isElectron}
                        placeholder="播放/暂停"
                        onChange={(event) => setPlayPauseShortcut(event.target.value)}
                      />
                      <Input
                        value={previousTrackShortcut}
                        disabled={!globalShortcutsEnabled || !isElectron}
                        placeholder="上一首"
                        onChange={(event) => setPreviousTrackShortcut(event.target.value)}
                      />
                      <Input
                        value={nextTrackShortcut}
                        disabled={!globalShortcutsEnabled || !isElectron}
                        placeholder="下一首"
                        onChange={(event) => setNextTrackShortcut(event.target.value)}
                      />
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-medium">播放记录同步 (Scrobble)</p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            支持 Last.fm / ListenBrainz
                          </p>
                        </div>
                        <select
                          value={scrobbleProvider}
                          onChange={(event) => {
                            setScrobbleProvider(event.target.value as "none" | "lastfm" | "listenbrainz");
                          }}
                          className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                        >
                          <option value="none">关闭</option>
                          <option value="lastfm">Last.fm</option>
                          <option value="listenbrainz">ListenBrainz</option>
                        </select>
                      </div>

                      {scrobbleProvider === "lastfm" ? (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <Input
                            value={lastFmApiKey}
                            placeholder="API Key"
                            onChange={(event) => setLastFmApiKey(event.target.value)}
                          />
                          <Input
                            value={lastFmApiSecret}
                            placeholder="API Secret"
                            onChange={(event) => setLastFmApiSecret(event.target.value)}
                          />
                          <Input
                            value={lastFmSessionKey}
                            placeholder="Session Key"
                            onChange={(event) => setLastFmSessionKey(event.target.value)}
                          />
                        </div>
                      ) : null}

                      {scrobbleProvider === "listenbrainz" ? (
                        <Input
                          value={listenBrainzToken}
                          placeholder="ListenBrainz Token"
                          onChange={(event) => setListenBrainzToken(event.target.value)}
                        />
                      ) : null}
                    </div>

                    <ToggleRow
                      label="桌面悬浮歌词"
                      description="当前为设置开关，后续可接入独立悬浮窗"
                      enabled={desktopLyricsEnabled}
                      onChange={setDesktopLyricsEnabled}
                      disabled={!isElectron}
                    />
                  </div>
                </section>
                )}

                {activeTab === "about" && (
                <section className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 dark:border-slate-800/80 dark:bg-slate-900/70">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold">关于</h3>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">应用与连接状态</p>
                  </div>

                  <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
                    <div className="flex items-center justify-between">
                      <span>版本</span>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800 dark:text-slate-100">v{__APP_VERSION__}</span>
                        <button
                          type="button"
                          onClick={() => { void updateChecker.checkForUpdate(); }}
                          disabled={updateChecker.isChecking}
                          className="rounded-md border border-slate-200 px-1.5 py-0.5 text-[11px] transition-colors hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
                        >
                          {updateChecker.isChecking ? "检查中..." : updateChecker.hasUpdate === false ? "已是最新" : "检查更新"}
                        </button>
                      </div>
                    </div>
                    <p className="flex items-center justify-between">
                      <span>连接状态</span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium",
                          isAuthenticated
                            ? "bg-[var(--accent-soft)] text-[var(--accent-text)]"
                            : "bg-amber-100 text-amber-700 dark:bg-amber-900/35 dark:text-amber-200",
                        )}
                      >
                        {isAuthenticated ? (
                          <CircleCheckBig className="h-3.5 w-3.5" />
                        ) : (
                          <CircleAlert className="h-3.5 w-3.5" />
                        )}
                        {isAuthenticated ? "已连接" : "未连接"}
                      </span>
                    </p>
                    <p className="flex items-center justify-between">
                      <span>服务器</span>
                      <span className="max-w-[220px] truncate font-medium text-slate-700 dark:text-slate-200">
                        {serverHost}
                      </span>
                    </p>
                  </div>

                  {isAuthenticated ? (
                    <Button
                      variant="outline"
                      className="mt-4 h-9 w-full justify-start"
                      onClick={() => {
                        logout();
                        onClose();
                      }}
                    >
                      <LogOut className="mr-2 h-4 w-4" />
                      退出登录
                    </Button>
                  ) : null}
                </section>
                )}
              </div>
            </motion.aside>
          </div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
