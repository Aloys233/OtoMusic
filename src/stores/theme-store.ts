import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "system";
type ResolvedThemeMode = Exclude<ThemeMode, "system">;

type ThemeState = {
  mode: ThemeMode;
  resolvedMode: ResolvedThemeMode;
  setMode: (mode: ThemeMode) => void;
  syncWithSystem: () => void;
};

const PREFER_DARK_QUERY = "(prefers-color-scheme: dark)";
let isSystemThemeListenerBound = false;

const resolveThemeMode = (mode: ThemeMode): ResolvedThemeMode => {
  if (mode !== "system") {
    return mode;
  }

  if (typeof window === "undefined") {
    return "dark";
  }

  return window.matchMedia(PREFER_DARK_QUERY).matches ? "dark" : "light";
};

const applyThemeClass = (mode: ResolvedThemeMode) => {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
};

const applyMode = (mode: ThemeMode) => {
  const resolvedMode = resolveThemeMode(mode);
  applyThemeClass(resolvedMode);
  return resolvedMode;
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: "system",
      resolvedMode: resolveThemeMode("system"),
      setMode: (mode) => {
        const resolvedMode = applyMode(mode);
        set({ mode, resolvedMode });
      },
      syncWithSystem: () => {
        const mode = get().mode;
        const resolvedMode = applyMode(mode);
        set({ resolvedMode });
      },
    }),
    {
      name: "otomusic-theme",
      partialize: (state) => ({ mode: state.mode }),
      onRehydrateStorage: () => (state) => {
        const mode = state?.mode ?? "system";
        const resolvedMode = applyMode(mode);
        useThemeStore.setState({ mode, resolvedMode });
      },
    },
  ),
);

function bindSystemThemeListener() {
  if (typeof window === "undefined" || isSystemThemeListenerBound) {
    return;
  }

  const mediaQuery = window.matchMedia(PREFER_DARK_QUERY);
  const onThemeChange = () => {
    const { mode } = useThemeStore.getState();
    if (mode !== "system") {
      return;
    }

    const resolvedMode = applyMode("system");
    useThemeStore.setState({ resolvedMode });
  };

  mediaQuery.addEventListener("change", onThemeChange);
  isSystemThemeListenerBound = true;
}

export function initializeTheme() {
  bindSystemThemeListener();
  useThemeStore.getState().syncWithSystem();
}
