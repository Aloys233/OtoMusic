import { ArrowLeft, ArrowRight, Minus, RefreshCw, Search, Square, X } from "lucide-react";
import { useMemo, useState } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent as ReactMouseEvent } from "react";

import { cn } from "@/lib/utils";

import { ThemeToggle } from "./ThemeToggle";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const isTauriRuntime =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type WindowTitlebarProps = {
  isAuthenticated?: boolean;
  searchKeyword?: string;
  onSearchKeywordChange?: (keyword: string) => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  searchSuggestions?: string[];
  onSearchSubmit?: (keyword: string) => void;
  className?: string;
};

export function WindowTitlebar({
  isAuthenticated = false,
  searchKeyword = "",
  onSearchKeywordChange,
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
  onRefresh,
  refreshing = false,
  searchSuggestions = [],
  onSearchSubmit,
  className,
}: WindowTitlebarProps) {
  const [searchFocused, setSearchFocused] = useState(false);
  const appWindow = useMemo(() => {
    if (!isTauriRuntime) {
      return null;
    }

    return getCurrentWindow();
  }, []);

  const handleDragStart = (event: ReactMouseEvent<HTMLElement>) => {
    if (!isTauriRuntime || !appWindow) {
      return;
    }

    if (event.button !== 0) {
      return;
    }

    const target = event.target as Element | null;
    if (!target) {
      return;
    }

    if (
      target.closest('[data-no-drag="true"]') ||
      target.closest("button, input, textarea, select, a, [role='button']")
    ) {
      return;
    }

    void appWindow.startDragging().catch(() => {
      // ignore drag start failure
    });
  };

  const normalizedSearchKeyword = searchKeyword.trim();
  const showSuggestions =
    isAuthenticated &&
    searchFocused &&
    normalizedSearchKeyword.length > 0 &&
    searchSuggestions.length > 0;

  const handleSubmitSearch = (keyword: string) => {
    const normalized = keyword.trim();
    if (!normalized) {
      return;
    }

    onSearchSubmit?.(normalized);
    setSearchFocused(false);
  };

  return (
    <header
      className={cn(
        "absolute inset-x-0 top-0 z-40 flex h-14 items-center justify-between gap-2 border-b border-slate-200/80 bg-slate-100/95 px-3 dark:border-slate-800/80 dark:bg-slate-950/95",
        className,
      )}
      onMouseDown={handleDragStart}
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="hidden text-xs font-medium tracking-[0.2em] text-slate-600 dark:text-slate-300 sm:block">
          OTO MUSIC
        </div>

        {isAuthenticated && (
          <div className="flex items-center gap-1" data-no-drag="true">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="nav-back"
              onClick={onGoBack}
              disabled={!canGoBack}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="nav-forward"
              onClick={onGoForward}
              disabled={!canGoForward}
            >
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="nav-refresh"
              onClick={onRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </Button>
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-2 pl-2">
        {isAuthenticated && (
          <div className="relative hidden w-full max-w-md flex-1 sm:block" data-no-drag="true">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              value={searchKeyword}
              onChange={(event) => onSearchKeywordChange?.(event.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => {
                window.setTimeout(() => {
                  setSearchFocused(false);
                }, 120);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") {
                  return;
                }

                event.preventDefault();
                handleSubmitSearch(searchKeyword);
              }}
              placeholder="搜索歌曲、专辑、艺术家"
              className="h-9 rounded-lg border-slate-200/80 bg-white/75 pl-9 pr-10 dark:border-slate-700/80 dark:bg-black/40"
            />
            <button
              type="button"
              aria-label="submit-search"
              onClick={() => handleSubmitSearch(searchKeyword)}
              className="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-200/80 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/70 dark:hover:text-white"
            >
              <Search className="h-4 w-4" />
            </button>

            {showSuggestions ? (
              <div className="absolute inset-x-0 top-11 z-50 max-h-64 overflow-y-auto rounded-xl border border-slate-200/80 bg-white/95 p-1 shadow-xl backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/95">
                {searchSuggestions.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    onClick={() => {
                      onSearchKeywordChange?.(candidate);
                      handleSubmitSearch(candidate);
                    }}
                    className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/70 dark:hover:text-white"
                  >
                    {candidate}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}

        <div data-no-drag="true">
          <ThemeToggle />
        </div>

        {isTauriRuntime && (
          <div className="flex items-center gap-1" data-no-drag="true">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="minimize-window"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => {
                void appWindow?.minimize();
              }}
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="maximize-window"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => {
                void appWindow?.toggleMaximize();
              }}
            >
              <Square className="h-3.5 w-3.5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 hover:bg-rose-500/25"
              aria-label="close-window"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => {
                void appWindow?.close();
              }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
