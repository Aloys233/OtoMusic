import React from "react";
import { cn } from "@/lib/utils";

interface SongListItemProps {
  id: string;
  index: number;
  title: string;
  artist: string;
  duration: string;
  isPlaying: boolean;
  onClick: (id: string) => void;
  onArtistClick?: (artist: string) => void;
}

export const SongListItem = React.memo(({
  id,
  index,
  title,
  artist,
  duration,
  isPlaying,
  onClick,
  onArtistClick,
}: SongListItemProps) => {
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className={cn(
        "song-list-item group mb-1 flex h-12 w-full items-center justify-between rounded-lg px-3 text-left transition-colors duration-200 outline-none",
        "hover:bg-slate-200/50 dark:hover:bg-slate-800/60",
        isPlaying ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : "text-slate-700 dark:text-slate-200",
      )}
    >
      <div className="mr-3 flex min-w-0 items-center gap-3">
        <span className={cn(
          "w-5 text-xs tabular-nums text-slate-400 transition-colors group-hover:text-[var(--accent-solid)]",
          isPlaying && "font-bold text-[var(--accent-solid)]"
        )}>
          {index + 1}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{title}</p>
          {onArtistClick ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onArtistClick(artist); }}
              className="truncate text-[0.68rem] text-slate-500 dark:text-slate-400 transition-colors hover:text-[var(--accent-text)] hover:underline"
            >
              {artist}
            </button>
          ) : (
            <p className="truncate text-[0.68rem] text-slate-500 dark:text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors">
              {artist}
            </p>
          )}
        </div>
      </div>

      <span className="text-xs text-slate-400 tabular-nums">{duration}</span>
    </button>
  );
});

SongListItem.displayName = "SongListItem";
