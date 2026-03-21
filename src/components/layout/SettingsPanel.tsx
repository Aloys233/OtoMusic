import { AnimatePresence, motion } from "framer-motion";
import {
  CircleAlert,
  CircleCheckBig,
  Laptop,
  LogOut,
  MoonStar,
  RefreshCw,
  SunMedium,
  X,
} from "lucide-react";
import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";

import { audioEngine } from "@/lib/audio/AudioEngine";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { useSettingsStore } from "@/stores/settings-store";
import { type ThemeMode, useThemeStore } from "@/stores/theme-store";

import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import { Slider } from "../ui/slider";

type SettingsPanelProps = {
  open: boolean;
  onClose: () => void;
};

const themeOptions: Array<{
  mode: ThemeMode;
  label: string;
  icon: typeof SunMedium;
}> = [
  { mode: "light", label: "浅色", icon: SunMedium },
  { mode: "dark", label: "深色", icon: MoonStar },
  { mode: "system", label: "跟随系统", icon: Laptop },
];

function formatDeviceLabel(device: MediaDeviceInfo, index: number) {
  if (device.deviceId === "default") {
    return "系统默认输出";
  }

  const label = device.label.trim();
  return label || `音频输出 ${index + 1}`;
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const mode = useThemeStore((state) => state.mode);
  const resolvedMode = useThemeStore((state) => state.resolvedMode);
  const setMode = useThemeStore((state) => state.setMode);

  const outputDeviceId = useSettingsStore((state) => state.outputDeviceId);
  const preampGainDb = useSettingsStore((state) => state.preampGainDb);
  const setOutputDeviceId = useSettingsStore((state) => state.setOutputDeviceId);
  const setPreampGainDb = useSettingsStore((state) => state.setPreampGainDb);

  const session = useAuthStore((state) => state.session);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const logout = useAuthStore((state) => state.logout);

  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const supportsOutputSelection = useMemo(() => audioEngine.supportsOutputDeviceSelection(), []);

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

  useEffect(() => {
    audioEngine.setPreampGainDb(preampGainDb);
  }, [preampGainDb]);

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
  }, [open, refreshOutputDevices]);

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

  return (
    <AnimatePresence>
      {open ? (
        <div className="pointer-events-none absolute inset-0 z-50">
          <motion.button
            type="button"
            aria-label="close-settings-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-auto absolute inset-0 bg-slate-950/35 backdrop-blur-[2px]"
            onClick={onClose}
          />

          <div className="pointer-events-none absolute inset-y-0 right-0 flex w-full max-w-lg pb-24 pl-10 pt-14 sm:pl-24">
            <motion.aside
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.24, ease: "easeOut" }}
              className="pointer-events-auto flex h-full w-full flex-col border-l border-slate-200/80 bg-white/94 shadow-2xl backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/95"
            >
              <header className="flex items-center justify-between border-b border-slate-200/70 px-4 py-3 dark:border-slate-800/70">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Settings</p>
                  <h2 className="text-lg font-semibold">偏好设置</h2>
                </div>
                <Button size="icon" variant="ghost" aria-label="close-settings" onClick={onClose}>
                  <X className="h-4 w-4" />
                </Button>
              </header>

              <div className="space-y-5 overflow-y-auto px-4 py-4">
                <section className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 dark:border-slate-800/80 dark:bg-slate-900/70">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold">通用</h3>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">主题模式</p>
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
                              ? "border-emerald-400/70 bg-emerald-50 text-emerald-700 dark:border-emerald-600/60 dark:bg-emerald-900/30 dark:text-emerald-200"
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
                </section>

                <section className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 dark:border-slate-800/80 dark:bg-slate-900/70">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold">音频</h3>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                        输出设备与播放增益
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
                          className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition-colors focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900"
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

                    <Separator />

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
                      />

                      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                        <span>-12 dB</span>
                        <button
                          type="button"
                          onClick={() => {
                            setPreampGainDb(0);
                            audioEngine.setPreampGainDb(0);
                          }}
                          className="rounded-md px-1.5 py-0.5 transition-colors hover:bg-slate-200/80 dark:hover:bg-slate-800"
                        >
                          重置
                        </button>
                        <span>+12 dB</span>
                      </div>
                    </div>

                    {deviceError ? (
                      <p className="flex items-start gap-1.5 rounded-lg border border-rose-200/80 bg-rose-50 px-2.5 py-2 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
                        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {deviceError}
                      </p>
                    ) : null}
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 dark:border-slate-800/80 dark:bg-slate-900/70">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold">关于</h3>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">应用与连接状态</p>
                  </div>

                  <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
                    <p className="flex items-center justify-between">
                      <span>版本</span>
                      <span className="font-medium text-slate-800 dark:text-slate-100">v{__APP_VERSION__}</span>
                    </p>
                    <p className="flex items-center justify-between">
                      <span>连接状态</span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium",
                          isAuthenticated
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/35 dark:text-emerald-200"
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
              </div>
            </motion.aside>
          </div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
