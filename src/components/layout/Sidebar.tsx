import { motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  Compass,
  Disc3,
  FolderTree,
  Heart,
  ListMusic,
  LogOut,
  Mic2,
  Music2,
  Settings2,
  Sparkles,
  Tags,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import {
  type LibraryNavSection,
  useLibraryStore,
} from "@/stores/library-store";

import { Button } from "../ui/button";

type SidebarProps = {
  onNavigateSection: (section: LibraryNavSection) => void;
  onOpenSettings: () => void;
};

type NavItem = {
  key: LibraryNavSection;
  icon: typeof Compass;
  label: string;
};

const navGroups: Array<{
  title: string;
  items: NavItem[];
}> = [
  {
    title: "探索 Explore",
    items: [
      { key: "for-you", icon: Sparkles, label: "为你推荐" },
      { key: "discover", icon: Compass, label: "发现" },
      { key: "recent-added", icon: Clock3, label: "最近播放" },
    ],
  },
  {
    title: "我的音乐 My Music",
    items: [
      { key: "albums", icon: Disc3, label: "专辑" },
      { key: "artists", icon: Mic2, label: "艺人" },
      { key: "songs", icon: Music2, label: "歌曲" },
      { key: "loved-tracks", icon: Heart, label: "我喜欢的音乐" },
      { key: "genres", icon: Tags, label: "流派" },
      { key: "folders", icon: FolderTree, label: "文件夹" },
    ],
  },
  {
    title: "歌单 Playlists",
    items: [{ key: "playlists", icon: ListMusic, label: "收藏歌单" }],
  },
];

export function Sidebar({ onNavigateSection, onOpenSettings }: SidebarProps) {
  const activeNavSection = useLibraryStore((state) => state.activeNavSection);
  const session = useAuthStore((state) => state.session);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const logout = useAuthStore((state) => state.logout);
  const [isCollapsed, setIsCollapsed] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 1320 : false,
  );
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onResize = () => {
      if (window.innerWidth < 1200) {
        setIsCollapsed(true);
      }
    };

    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    if (!isAccountMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!accountMenuRef.current) {
        return;
      }

      if (!accountMenuRef.current.contains(event.target as Node)) {
        setIsAccountMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isAccountMenuOpen]);

  const serverHost = (() => {
    if (!session?.baseUrl) {
      return "未连接";
    }

    try {
      return new URL(session.baseUrl).host;
    } catch {
      return session.baseUrl;
    }
  })();
  const accountInitial = session?.username?.slice(0, 1).toUpperCase() ?? "U";
  const connectionLabel = isAuthenticated ? "已连接服务器" : "未连接服务器";

  const handleOpenSettingsFromMenu = () => {
    setIsAccountMenuOpen(false);
    onOpenSettings();
  };

  return (
    <motion.aside
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className={cn(
        "relative z-20 hidden h-full shrink-0 border-r border-slate-200/80 bg-slate-100/90 transition-[width] duration-200 dark:border-slate-800/80 dark:bg-slate-950/85 lg:flex lg:flex-col",
        isCollapsed ? "w-[84px]" : "w-60",
      )}
    >
      <div
        className={cn(
          "flex items-center border-b border-slate-200/70 pb-3 pt-4 dark:border-slate-800/70",
          isCollapsed ? "justify-center px-2" : "justify-between px-4",
        )}
      >
        {!isCollapsed ? (
          <div className="min-w-0">
            <h2 className="text-[0.74rem] font-semibold tracking-[0.16em] text-slate-600 dark:text-slate-200">
              音乐导航
            </h2>
            <p className="mt-1 text-[0.64rem] tracking-[0.12em] text-slate-500 dark:text-slate-400">
              浏览音乐内容
            </p>
          </div>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-lg"
          aria-label={isCollapsed ? "expand-sidebar" : "collapse-sidebar"}
          title={isCollapsed ? "展开侧边栏" : "收起侧边栏"}
          onClick={() => {
            setIsCollapsed((prev) => !prev);
            setIsAccountMenuOpen(false);
          }}
        >
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 py-3">
        {navGroups.map((group, groupIndex) => (
          <motion.section
            key={group.title}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.04 + groupIndex * 0.03, duration: 0.24 }}
            className={cn(
              groupIndex > 0 &&
                "mt-5 border-t border-slate-200/75 pt-5 dark:border-slate-800/75",
            )}
          >
            {!isCollapsed ? (
              <p className="px-2 pb-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                {group.title}
              </p>
            ) : null}
            <div className="space-y-1.5">
              {group.items.map((item) => {
                const active = activeNavSection === item.key;

                return (
                  <div key={item.key} className="relative">
                    {active ? (
                      <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-[var(--accent-solid)]" />
                    ) : null}
                    <Button
                      variant="ghost"
                      disabled={!isAuthenticated}
                      onClick={() => {
                        onNavigateSection(item.key);
                      }}
                      title={item.label}
                      className={cn(
                        "h-10 w-full rounded-xl text-sm transition-colors",
                        isCollapsed ? "justify-center px-0" : "justify-start pl-5 pr-3",
                        active
                          ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent-text)] hover:bg-[var(--accent-soft-strong)]"
                          : "text-slate-700 hover:bg-slate-200/45 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/60 dark:hover:text-white",
                      )}
                    >
                      <item.icon
                        className={cn("h-4 w-4 shrink-0", !isCollapsed && "mr-2.5")}
                      />
                      {!isCollapsed ? item.label : null}
                    </Button>
                  </div>
                );
              })}
            </div>
          </motion.section>
        ))}
      </nav>

      <div className={cn("m-3 mt-auto text-xs text-slate-700 dark:text-slate-300", isCollapsed && "mx-2")}>
        <div ref={accountMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setIsAccountMenuOpen((prev) => !prev)}
            className={cn(
              "flex w-full items-center rounded-xl border border-slate-200/80 bg-white/90 py-2 text-left transition-colors hover:border-[var(--accent-border)] dark:border-slate-800 dark:bg-slate-900/85 dark:hover:border-[var(--accent-border)]",
              isCollapsed ? "justify-center px-2" : "gap-2 px-3",
            )}
            title={isAuthenticated ? `连接地址: ${serverHost}` : "未连接服务器"}
            aria-label="account-menu"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[0.65rem] font-semibold text-[var(--accent-text)]">
              {accountInitial}
            </span>

            {!isCollapsed ? (
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-medium">{session?.username ?? "未登录"}</span>
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      isAuthenticated ? "bg-[var(--accent-solid)]" : "bg-amber-500",
                    )}
                  />
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-slate-500 dark:text-slate-400">
                  {connectionLabel}
                </span>
              </span>
            ) : null}

            {!isCollapsed ? <Settings2 className="h-3.5 w-3.5 text-slate-400" /> : null}
          </button>

          {isAccountMenuOpen ? (
            <div
              className={cn(
                "absolute z-40 overflow-hidden rounded-xl border border-slate-200/90 bg-white/95 p-1 shadow-xl backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/95",
                isCollapsed ? "bottom-12 left-0 w-52" : "bottom-[calc(100%+8px)] left-0 right-0",
              )}
            >
              <button
                type="button"
                onClick={handleOpenSettingsFromMenu}
                className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-xs text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/70 dark:hover:text-white"
              >
                <Settings2 className="mr-2 h-3.5 w-3.5" />
                设置
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsAccountMenuOpen(false);
                  logout();
                }}
                disabled={!isAuthenticated}
                className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-xs text-rose-600 transition-colors hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-300 dark:hover:bg-rose-900/30 dark:hover:text-rose-200"
              >
                <LogOut className="mr-2 h-3.5 w-3.5" />
                退出登录
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </motion.aside>
  );
}
