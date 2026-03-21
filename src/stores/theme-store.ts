import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "light" | "dark";

type ThemeState = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
};

const applyThemeClass = (mode: ThemeMode) => {
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: "dark",
      setMode: (mode) => {
        applyThemeClass(mode);
        set({ mode });
      },
      toggleMode: () => {
        const mode = get().mode === "dark" ? "light" : "dark";
        applyThemeClass(mode);
        set({ mode });
      },
    }),
    {
      name: "otomusic-theme",
      partialize: (state) => ({ mode: state.mode }),
      onRehydrateStorage: () => (state) => {
        if (state?.mode) {
          applyThemeClass(state.mode);
        }
      },
    },
  ),
);

export function initializeTheme() {
  const mode = useThemeStore.getState().mode;
  applyThemeClass(mode);
}
