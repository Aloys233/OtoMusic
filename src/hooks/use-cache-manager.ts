import { useCallback, useEffect, useState } from "react";

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const size = value / 1024 ** index;
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[index]}`;
}

export function useCacheManager() {
  const [usageText, setUsageText] = useState("-");
  const [usageBytes, setUsageBytes] = useState(0);
  const [quotaBytes, setQuotaBytes] = useState(0);
  const [isClearing, setIsClearing] = useState(false);

  const refresh = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
      setUsageText("Unavailable");
      return;
    }

    try {
      const estimate = await navigator.storage.estimate();
      const usage = estimate.usage ?? 0;
      const quota = estimate.quota ?? 0;
      setUsageBytes(usage);
      setQuotaBytes(quota);

      if (!quota) {
        setUsageText(formatBytes(usage));
        return;
      }

      const ratio = ((usage / quota) * 100).toFixed(1);
      setUsageText(`${formatBytes(usage)} / ${formatBytes(quota)} (${ratio}%)`);
    } catch {
      setUsageBytes(0);
      setQuotaBytes(0);
      setUsageText("Unavailable");
    }
  }, []);

  const clearCaches = useCallback(async () => {
    setIsClearing(true);

    try {
      if (typeof caches !== "undefined") {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }

      // 本地缓存清理仅作用于 Cache Storage，避免误删账号等关键持久化数据。
    } finally {
      setIsClearing(false);
      void refresh();
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    usageText,
    usageBytes,
    quotaBytes,
    isClearing,
    clearCaches,
    refresh,
  };
}
