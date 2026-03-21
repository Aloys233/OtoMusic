import { motion } from "framer-motion";
import {
  Clock3,
  Compass,
  Disc3,
  ListMusic,
  LogOut,
  Settings,
  Wifi,
  WifiOff,
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
};

const navItems: Array<{
  key: LibraryNavSection;
  icon: typeof Compass;
  label: string;
}> = [
  { key: "discover", icon: Compass, label: "发现" },
  { key: "albums", icon: Disc3, label: "专辑库" },
  { key: "recent-added", icon: Clock3, label: "最近添加" },
  { key: "playlists", icon: ListMusic, label: "收藏" },
];

export function Sidebar({ onNavigateSection }: SidebarProps) {
  const activeNavSection = useLibraryStore((state) => state.activeNavSection);

  const session = useAuthStore((state) => state.session);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const logout = useAuthStore((state) => state.logout);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement | null>(null);

  const serverHost = (() => {
    if (!session?.baseUrl) {
      return "";
    }

    try {
      return new URL(session.baseUrl).host;
    } catch {
      return session.baseUrl;
    }
  })();
  const accountInitial = session?.username?.slice(0, 1).toUpperCase() ?? "U";

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }

    const onMouseDown = (event: MouseEvent) => {
      if (!settingsRef.current) {
        return;
      }

      if (!settingsRef.current.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    };

    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [settingsOpen]);

  useEffect(() => {
    if (isAuthenticated) {
      return;
    }

    setSettingsOpen(false);
  }, [isAuthenticated]);

  return (
    <motion.aside
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="relative z-20 hidden h-full w-56 shrink-0 border-r border-slate-200/80 bg-slate-100 dark:border-slate-800/80 dark:bg-slate-950 lg:flex lg:flex-col"
    >
      <div className="p-4 pb-3">
        <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-300">
          Library
        </h2>
      </div>

      <nav className="flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {navItems.map((item, index) => {
          const active = activeNavSection === item.key;

          return (
            <motion.div
              key={item.key}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 + index * 0.04, duration: 0.25 }}
            >
              <div className="relative">
                {active ? (
                  <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-emerald-500" />
                ) : null}
                <Button
                  variant="ghost"
                  disabled={!isAuthenticated}
                  onClick={() => {
                    onNavigateSection(item.key);
                    setSettingsOpen(false);
                  }}
                  className={cn(
                    "h-11 w-full justify-start rounded-xl pl-5 text-sm",
                    active
                      ? "bg-emerald-100/80 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/45 dark:text-emerald-300 dark:hover:bg-emerald-950/55"
                      : "text-slate-700 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/70 dark:hover:text-white",
                  )}
                >
                  <item.icon className="mr-2.5 h-4 w-4" />
                  {item.label}
                </Button>
              </div>
            </motion.div>
          );
        })}
      </nav>

      <div ref={settingsRef} className="relative m-3 mt-auto text-xs text-slate-700 dark:text-slate-300">
        <Button
          variant="ghost"
          onClick={() => setSettingsOpen((prev) => !prev)}
          className="h-11 w-full justify-between rounded-full border border-slate-200/80 bg-white px-2.5 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
        >
          <span className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-[0.7rem] font-semibold text-emerald-700 dark:bg-emerald-900/45 dark:text-emerald-300">
              {accountInitial}
            </span>
            <span className="text-xs font-medium">账户与设置</span>
          </span>
          <Settings className="h-4 w-4 text-slate-500 dark:text-slate-300" />
        </Button>

        {settingsOpen ? (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="absolute bottom-14 left-0 right-0 z-30 rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="mb-2 flex items-center gap-2 font-medium">
              {isAuthenticated ? (
                <Wifi className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <WifiOff className="h-3.5 w-3.5 text-amber-500" />
              )}
              {isAuthenticated ? "已连接 Navidrome" : "未连接 Navidrome"}
            </div>

            {isAuthenticated ? (
              <>
                <p className="mb-3 truncate text-xs text-slate-600 dark:text-slate-300">{serverHost}</p>
                <Button
                  variant="outline"
                  className="h-8 w-full justify-start text-xs"
                  onClick={() => {
                    logout();
                    setSettingsOpen(false);
                  }}
                >
                  <LogOut className="mr-2 h-3.5 w-3.5" />
                  退出登录
                </Button>
              </>
            ) : (
              <p className="text-xs text-slate-600 dark:text-slate-300">请先登录你的 Navidrome 服务器。</p>
            )}
          </motion.div>
        ) : null}
      </div>
    </motion.aside>
  );
}
