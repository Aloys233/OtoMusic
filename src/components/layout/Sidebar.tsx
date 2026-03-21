import { motion } from "framer-motion";
import {
  Clock3,
  Compass,
  Disc3,
  ListMusic,
  Mic2,
  Music2,
  Settings2,
  Wifi,
  WifiOff,
} from "lucide-react";

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
    title: "为你推荐",
    items: [
      { key: "discover", icon: Compass, label: "发现" },
      { key: "recent-added", icon: Clock3, label: "最近播放" },
    ],
  },
  {
    title: "库",
    items: [
      { key: "albums", icon: Disc3, label: "专辑" },
      { key: "artists", icon: Mic2, label: "艺人" },
      { key: "songs", icon: Music2, label: "歌曲" },
    ],
  },
  {
    title: "播放列表",
    items: [{ key: "playlists", icon: ListMusic, label: "收藏歌单" }],
  },
];

export function Sidebar({ onNavigateSection, onOpenSettings }: SidebarProps) {
  const activeNavSection = useLibraryStore((state) => state.activeNavSection);
  const session = useAuthStore((state) => state.session);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

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

  return (
    <motion.aside
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="relative z-20 hidden h-full w-60 shrink-0 border-r border-slate-200/80 bg-slate-100/90 dark:border-slate-800/80 dark:bg-slate-950/85 lg:flex lg:flex-col"
    >
      <div className="px-4 pb-3 pt-4">
        <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-300">
          Library
        </h2>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-1">
        {navGroups.map((group, groupIndex) => (
          <motion.section
            key={group.title}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.04 + groupIndex * 0.03, duration: 0.24 }}
          >
            <p className="px-2 pb-1 text-[0.68rem] font-semibold uppercase tracking-[0.17em] text-slate-500 dark:text-slate-400">
              {group.title}
            </p>
            <div className="space-y-1.5">
              {group.items.map((item) => {
                const active = activeNavSection === item.key;

                return (
                  <div key={item.key} className="relative">
                    {active ? (
                      <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-emerald-500" />
                    ) : null}
                    <Button
                      variant="ghost"
                      disabled={!isAuthenticated}
                      onClick={() => {
                        onNavigateSection(item.key);
                      }}
                      className={cn(
                        "h-10 w-full justify-start rounded-xl pl-5 text-sm",
                        active
                          ? "bg-emerald-100/80 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/45 dark:text-emerald-300 dark:hover:bg-emerald-950/55"
                          : "text-slate-700 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/70 dark:hover:text-white",
                      )}
                    >
                      <item.icon className="mr-2.5 h-4 w-4" />
                      {item.label}
                    </Button>
                  </div>
                );
              })}
            </div>
          </motion.section>
        ))}
      </nav>

      <div className="m-3 mt-auto space-y-2 text-xs text-slate-700 dark:text-slate-300">
        <div className="rounded-xl border border-slate-200/80 bg-white/90 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/85">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-[0.65rem] font-semibold text-emerald-700 dark:bg-emerald-900/45 dark:text-emerald-300">
              {accountInitial}
            </span>
            <span className="truncate text-xs font-medium">{session?.username ?? "未登录"}</span>
          </div>
          <p className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
            {isAuthenticated ? (
              <Wifi className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-amber-500" />
            )}
            {serverHost}
          </p>
        </div>

        <Button
          variant="outline"
          className="h-10 w-full justify-start rounded-xl"
          onClick={onOpenSettings}
        >
          <Settings2 className="mr-2 h-4 w-4" />
          设置
        </Button>
      </div>
    </motion.aside>
  );
}
