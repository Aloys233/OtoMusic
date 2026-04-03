import { useCallback, useState } from "react";

const GITHUB_API_URL = "https://api.github.com/repos/Aloys233/OtoMusic/releases/latest";
const GITHUB_RELEASE_PAGE = "https://github.com/Aloys233/OtoMusic/releases/latest";

const PROXY_MIRRORS = [
  "https://gh-proxy.org/",
  "https://hk.gh-proxy.org/",
  "https://cdn.gh-proxy.org/",
  "https://edgeone.gh-proxy.org/",
];

type ReleaseInfo = {
  tag_name: string;
  html_url: string;
};

function stripLeadingV(version: string) {
  return version.startsWith("v") ? version.slice(1) : version;
}

function isNewerVersion(latest: string, current: string) {
  const latestParts = stripLeadingV(latest).split(".").map(Number);
  const currentParts = stripLeadingV(current).split(".").map(Number);
  const length = Math.max(latestParts.length, currentParts.length);

  for (let i = 0; i < length; i++) {
    const l = latestParts[i] ?? 0;
    const c = currentParts[i] ?? 0;
    if (l > c) return true;
    if (l < c) return false;
  }

  return false;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/vnd.github.v3+json" },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLatestRelease(): Promise<ReleaseInfo> {
  // Try direct GitHub API first
  try {
    const response = await fetchWithTimeout(GITHUB_API_URL, 8000);
    if (response.ok) {
      return await response.json();
    }
  } catch {
    // Direct access failed, try proxies
  }

  // Try proxy mirrors in order
  for (const proxy of PROXY_MIRRORS) {
    try {
      const response = await fetchWithTimeout(`${proxy}${GITHUB_API_URL}`, 8000);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      continue;
    }
  }

  throw new Error("所有更新源均不可用，请检查网络连接");
}

type UpdateCheckerState = {
  isChecking: boolean;
  hasUpdate: boolean | null;
  latestVersion: string | null;
  releaseUrl: string | null;
  error: string | null;
};

export type UpdateCheckerResult = UpdateCheckerState & {
  checkForUpdate: () => Promise<void>;
};

export function useUpdateChecker(): UpdateCheckerResult {
  const [state, setState] = useState<UpdateCheckerState>({
    isChecking: false,
    hasUpdate: null,
    latestVersion: null,
    releaseUrl: null,
    error: null,
  });

  const checkForUpdate = useCallback(async () => {
    setState({
      isChecking: true,
      hasUpdate: null,
      latestVersion: null,
      releaseUrl: null,
      error: null,
    });

    try {
      const release = await fetchLatestRelease();
      const latestVersion = release.tag_name;
      const hasUpdate = isNewerVersion(latestVersion, __APP_VERSION__);

      setState({
        isChecking: false,
        hasUpdate,
        latestVersion: stripLeadingV(latestVersion),
        releaseUrl: release.html_url || GITHUB_RELEASE_PAGE,
        error: null,
      });
    } catch (err) {
      setState({
        isChecking: false,
        hasUpdate: null,
        latestVersion: null,
        releaseUrl: null,
        error: err instanceof Error ? err.message : "检查更新失败",
      });
    }
  }, []);

  return { ...state, checkForUpdate };
}
