import React from "react";

interface AlbumGridItemProps {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  onClick: (id: string) => void;
  onArtistClick?: (artist: string) => void;
}

export const AlbumGridItem = React.memo(({ id, title, artist, coverUrl, onClick, onArtistClick }: AlbumGridItemProps) => {
  return (
    <div className="album-grid-item">
      <button
        type="button"
        onClick={() => onClick(id)}
        className="w-full text-left outline-none group flex flex-col gap-2"
      >
        <div className="aspect-square w-full overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900/40 relative">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={`${title} cover`}
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="h-full w-full bg-slate-200 dark:bg-slate-800" />
          )}
          {/* 移除复杂的 Hover 动画效果，保留最基础的点击态 */}
          <div className="absolute inset-0 bg-black/0 group-active:bg-black/5 dark:group-active:bg-white/5 transition-colors" />
        </div>

        <div className="px-1 min-w-0">
          <p className="truncate text-sm font-semibold leading-snug text-slate-900 dark:text-slate-100">{title}</p>
          {onArtistClick ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onArtistClick(artist); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onArtistClick(artist); } }}
              className="block truncate text-xs text-slate-500 dark:text-slate-400 mt-0.5 transition-colors hover:text-[var(--accent-text)] hover:underline cursor-pointer"
            >
              {artist}
            </span>
          ) : (
            <p className="truncate text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {artist}
            </p>
          )}
        </div>
      </button>
    </div>
  );
});

AlbumGridItem.displayName = "AlbumGridItem";
