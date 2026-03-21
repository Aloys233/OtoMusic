import { MoonStar, SunMedium } from "lucide-react";

import { useThemeStore } from "@/stores/theme-store";

import { Button } from "../ui/button";

export function ThemeToggle() {
  const mode = useThemeStore((state) => state.mode);
  const toggleMode = useThemeStore((state) => state.toggleMode);

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="toggle-theme"
      onClick={toggleMode}
      className="border border-slate-200 bg-white hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
    >
      {mode === "dark" ? <SunMedium className="h-4 w-4" /> : <MoonStar className="h-4 w-4" />}
    </Button>
  );
}
