import { useEffect, useRef } from "react";

/**
 * 为滚动容器添加平滑滚动（lerp 插值）。
 * WebKitGTK (Linux Tauri) 原生不提供滚动缓动，
 * 此 hook 拦截 wheel 事件并用 RAF 动画平滑滚动位置。
 */
export function useSmoothScroll(ref: React.RefObject<HTMLElement | null>) {
  const state = useRef({
    target: 0,
    current: 0,
    animating: false,
    rafId: 0,
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const s = state.current;
    s.target = el.scrollTop;
    s.current = el.scrollTop;

    const LERP = 0.14;
    const SNAP = 0.5;

    const animate = () => {
      const diff = s.target - s.current;

      if (Math.abs(diff) < SNAP) {
        s.current = s.target;
        el.scrollTop = s.target;
        s.animating = false;
        return;
      }

      s.current += diff * LERP;
      el.scrollTop = s.current;
      s.rafId = requestAnimationFrame(animate);
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 40;
      else if (e.deltaMode === 2) dy *= el.clientHeight;

      const maxScroll = el.scrollHeight - el.clientHeight;
      s.target = Math.max(0, Math.min(s.target + dy, maxScroll));

      if (!s.animating) {
        s.animating = true;
        s.rafId = requestAnimationFrame(animate);
      }
    };

    // 同步：当滚动条拖拽或程序化滚动时，保持 target/current 一致
    const handleScroll = () => {
      if (!s.animating) {
        s.target = el.scrollTop;
        s.current = el.scrollTop;
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    el.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("scroll", handleScroll);
      cancelAnimationFrame(s.rafId);
    };
  }, [ref]);
}
