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
        className="group flex w-full flex-col gap-2 text-left outline-none"
      >
        <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 transition-[transform,border-color,box-shadow] duration-[320ms] ease-in-out group-hover:scale-[1.015] group-hover:border-[var(--accent-border)] group-hover:shadow-[0_10px_28px_rgba(15,23,42,0.18)] dark:border-slate-800 dark:bg-slate-900/40 dark:group-hover:shadow-[0_10px_30px_rgba(2,6,23,0.45)]">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={`${title} cover`}
              className="h-full w-full object-cover transition-transform duration-[360ms] ease-in-out group-hover:scale-[1.035]"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="h-full w-full bg-slate-200 dark:bg-slate-800" />
          )}
          <div className="absolute inset-0 bg-black/0 transition-colors duration-[320ms] ease-in-out group-hover:bg-black/[0.03] group-active:bg-black/5 dark:group-hover:bg-white/[0.04] dark:group-active:bg-white/5" />
        </div>

        <div className="min-w-0 px-1">
          <p className="truncate text-sm font-semibold leading-snug text-slate-900 dark:text-slate-100">{title}</p>
          {!onArtistClick ? (
            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
              {artist}
            </p>
          ) : null}
        </div>
      </button>
      {onArtistClick ? (
        <button
          type="button"
          onClick={() => onArtistClick(artist)}
          className="mt-0.5 block max-w-full truncate px-1 text-left text-xs text-slate-500 transition-colors hover:text-[var(--accent-text)] hover:underline dark:text-slate-400"
        >
          {artist}
        </button>
      ) : null}
    </div>
  );
});

AlbumGridItem.displayName = "AlbumGridItem";
