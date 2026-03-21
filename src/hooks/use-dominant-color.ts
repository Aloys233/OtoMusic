import { useEffect, useState } from "react";

const FALLBACK = "rgba(34, 197, 94, 0.16)";

function toRgba(r: number, g: number, b: number, alpha: number) {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function averageColor(data: Uint8ClampedArray) {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (let i = 0; i < data.length; i += 16) {
    r += data[i] ?? 0;
    g += data[i + 1] ?? 0;
    b += data[i + 2] ?? 0;
    count += 1;
  }

  if (count === 0) {
    return null;
  }

  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count),
  };
}

export function useDominantColor(imageUrl: string | null) {
  const [glowColor, setGlowColor] = useState(FALLBACK);

  useEffect(() => {
    if (!imageUrl) {
      setGlowColor(FALLBACK);
      return;
    }

    const image = new Image();
    image.crossOrigin = "anonymous";
    image.referrerPolicy = "no-referrer";

    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { willReadFrequently: true });

        if (!context) {
          setGlowColor(FALLBACK);
          return;
        }

        const size = 48;
        canvas.width = size;
        canvas.height = size;
        context.drawImage(image, 0, 0, size, size);

        const pixels = context.getImageData(0, 0, size, size).data;
        const average = averageColor(pixels);

        if (!average) {
          setGlowColor(FALLBACK);
          return;
        }

        setGlowColor(toRgba(average.r, average.g, average.b, 0.24));
      } catch {
        setGlowColor(FALLBACK);
      }
    };

    image.onerror = () => {
      setGlowColor(FALLBACK);
    };

    image.src = imageUrl;
  }, [imageUrl]);

  return glowColor;
}
