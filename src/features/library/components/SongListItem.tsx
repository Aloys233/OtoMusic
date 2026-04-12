import React from "react";
import { cn } from "@/lib/utils";

interface SongListItemProps {
  id: string;
  index: number;
  title: string;
  artist: string;
  artistNames?: string[];
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
  artistNames,
  duration,
  isPlaying,
  onClick,
  onArtistClick,
}: SongListItemProps) => {
  const displayArtistNames = artistNames?.length ? artistNames : [artist];

  return (
    <div
      onDoubleClick={() => onClick(id)}
      title="双击播放"
      className={cn(
        "song-list-item group mb-1 grid h-12 w-full grid-cols-[28px_minmax(0,1.35fr)_minmax(88px,0.9fr)_48px] items-center gap-3 rounded-lg px-3 text-left outline-none transition-colors duration-[320ms] ease-in-out sm:grid-cols-[28px_minmax(0,1.6fr)_minmax(128px,1fr)_54px]",
        "hover:bg-slate-200/50 dark:hover:bg-slate-800/60",
        isPlaying ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : "text-slate-700 dark:text-slate-200",
      )}
    >
      <span className={cn(
        "text-left text-xs tabular-nums text-slate-400 transition-colors group-hover:text-[var(--accent-solid)]",
        isPlaying && "font-bold text-[var(--accent-solid)]",
      )}>
        {index + 1}
      </span>

      <p className="min-w-0 truncate text-left text-sm font-medium">
        {title}
      </p>

      {onArtistClick ? (
        <div
          onDoubleClick={(event) => event.stopPropagation()}
          className="min-w-0 truncate text-left text-[0.68rem] text-slate-500 dark:text-slate-400"
        >
          {displayArtistNames.map((artistName, artistIndex) => (
            <React.Fragment key={`${id}-artist-${artistName}-${artistIndex}`}>
              {artistIndex > 0 ? <span className="px-1 text-slate-400">/</span> : null}
              <button
                type="button"
                onClick={() => onArtistClick(artistName)}
                className="transition-colors hover:text-[var(--accent-text)] hover:underline"
              >
                {artistName}
              </button>
            </React.Fragment>
          ))}
        </div>
      ) : (
        <p className="min-w-0 truncate text-left text-[0.68rem] text-slate-500 transition-colors group-hover:text-slate-600 dark:text-slate-400 dark:group-hover:text-slate-300">
          {displayArtistNames.join(" / ")}
        </p>
      )}

      <span className="justify-self-end text-xs tabular-nums text-slate-400">{duration}</span>
    </div>
  );
});

SongListItem.displayName = "SongListItem";
