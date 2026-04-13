import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createSubsonicClient } from "@/lib/api/client";
import { clearSecureSession, loadSecureSession, saveSecureSession } from "@/lib/desktop-api";
import { getServerNetworkKind, normalizeServerBaseUrl, sortServerUrlsByNetwork } from "@/lib/server-url";

export type AuthSession = {
  baseUrl: string;
  username: string;
  password: string;
};

export type ServerConfig = {
  name: string;
  primaryUrl: string;
  fallbackUrls: string[];
  username: string;
  password: string;
  apiKey?: string;
};

type AuthState = {
  session: AuthSession | null;
  isAuthenticated: boolean;
  isLoggingIn: boolean;
  isRestoringSession: boolean;
  loginError: string | null;
  serverConfig: ServerConfig | null;
  login: (session: AuthSession) => Promise<boolean>;
  restoreSecureSession: () => Promise<void>;
  saveServerConfig: (config: ServerConfig) => void;
  clearServerConfig: () => void;
  addFallbackUrl: (url: string) => void;
  removeFallbackUrl: (url: string) => void;
  switchActiveUrl: (url: string) => Promise<boolean>;
  autoSwitchActiveUrl: () => Promise<boolean>;
  logout: () => void;
  clearLoginError: () => void;
};

function normalizeSession(session: AuthSession): AuthSession {
  return {
    baseUrl: normalizeServerBaseUrl(session.baseUrl),
    username: session.username.trim(),
    password: session.password,
  };
}

function sanitizeSessionForPersist(session: AuthSession | null) {
  if (!session) {
    return null;
  }

  return {
    ...session,
    password: "",
  };
}

function sanitizeServerConfigForPersist(config: ServerConfig | null) {
  if (!config) {
    return null;
  }

  return {
    ...config,
    password: "",
  };
}

function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as Record<string, unknown>;
  if (err.code === "ECONNABORTED" || err.code === "ERR_NETWORK" || err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") return true;
  if (err.message && typeof err.message === "string" && /timeout|network|ECONNREFUSED|ENOTFOUND|ERR_NETWORK/.test(err.message)) return true;
  if (err.response === undefined && err.request !== undefined) return true;
  return false;
}

function normalizeUniqueServerUrls(urls: string[]) {
  const normalized: string[] = [];
  for (const url of urls) {
    try {
      const nextUrl = normalizeServerBaseUrl(url);
      if (!normalized.includes(nextUrl)) {
        normalized.push(nextUrl);
      }
    } catch {
      // 跳过无效地址。
    }
  }
  return normalized;
}

function getServerConfigUrls(config: ServerConfig | null, currentBaseUrl: string) {
  return normalizeUniqueServerUrls([
    currentBaseUrl,
    config?.primaryUrl ?? "",
    ...(config?.fallbackUrls ?? []),
  ]);
}

async function selectBestReachableUrl(session: AuthSession, candidateUrls: string[]) {
  const urls = sortServerUrlsByNetwork(normalizeUniqueServerUrls(candidateUrls));
  if (urls.length === 0) {
    throw new Error("没有可用的服务器地址");
  }

  const probes = await Promise.all(
    urls.map(async (url) => {
      const startedAt = performance.now();
      try {
        const client = createSubsonicClient({
          ...session,
          baseUrl: url,
          timeoutMs: 4_000,
        });
        await client.ping();
        return {
          url,
          kind: getServerNetworkKind(url),
          elapsedMs: performance.now() - startedAt,
          error: null,
        };
      } catch (error) {
        return {
          url,
          kind: getServerNetworkKind(url),
          elapsedMs: Number.POSITIVE_INFINITY,
          error,
        };
      }
    }),
  );

  const reachable = probes
    .filter((probe) => probe.error === null)
    .sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === "lan" ? -1 : 1;
      }
      return a.elapsedMs - b.elapsedMs;
    });

  if (reachable[0]) {
    return reachable[0].url;
  }

  const authOrServerError = probes.find((probe) => probe.error && !isNetworkError(probe.error));
  const lastError = authOrServerError?.error ?? probes[0]?.error;
  throw lastError instanceof Error ? lastError : new Error("服务器地址均不可用");
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,
      isAuthenticated: false,
      isLoggingIn: false,
      isRestoringSession: false,
      loginError: null,
      serverConfig: null,
      login: async (session) => {
        let normalized: AuthSession;
        try {
          normalized = normalizeSession(session);
        } catch (error) {
          set({
            loginError: error instanceof Error ? error.message : "服务器地址格式不正确",
            isLoggingIn: false,
          });
          return false;
        }

        if (!normalized.baseUrl || !normalized.username || !normalized.password) {
          set({ loginError: "请完整填写地址、用户名和密码" });
          return false;
        }

        set({ isLoggingIn: true, loginError: null });

        const config = get().serverConfig;
        const urlsToTry = getServerConfigUrls(config, normalized.baseUrl);

        try {
          const url = await selectBestReachableUrl(normalized, urlsToTry);

          try {
            await saveSecureSession({ ...normalized, baseUrl: url });
          } catch (error) {
            console.warn(
              "[OtoMusic] secure credential storage unavailable",
              error instanceof Error ? error.message : error,
            );
          }

          set({
            session: { ...normalized, baseUrl: url },
            isAuthenticated: true,
            isLoggingIn: false,
            loginError: null,
          });

          return true;
        } catch (error) {
          set((state) => ({
            isLoggingIn: false,
            isAuthenticated: state.isAuthenticated,
            session: state.session,
            loginError:
              error instanceof Error ? error.message : "登录失败，请检查服务器地址与账号信息",
          }));
          return false;
        }
      },
      restoreSecureSession: async () => {
        const state = get();
        const persistedSession = state.session;
        set({ isRestoringSession: true });

        try {
          const secureSession = await loadSecureSession();
          const candidate = secureSession ?? (
            persistedSession?.baseUrl && persistedSession.username && persistedSession.password
              ? persistedSession
              : null
          );

          if (!candidate) {
            set({
              isAuthenticated: false,
              isRestoringSession: false,
              session: persistedSession ? sanitizeSessionForPersist(persistedSession) : null,
            });
            return;
          }

          const normalized = normalizeSession(candidate);
          const activeBaseUrl = await selectBestReachableUrl(
            normalized,
            getServerConfigUrls(state.serverConfig, normalized.baseUrl),
          );
          const activeSession = { ...normalized, baseUrl: activeBaseUrl };

          if (!secureSession || activeSession.baseUrl !== normalized.baseUrl) {
            try {
              await saveSecureSession(activeSession);
            } catch (error) {
              console.warn(
                "[OtoMusic] failed to migrate credentials into secure storage",
                error instanceof Error ? error.message : error,
              );
            }
          }

          set({
            session: activeSession,
            isAuthenticated: true,
            isRestoringSession: false,
            loginError: null,
          });
        } catch (error) {
          set({
            isAuthenticated: false,
            isRestoringSession: false,
            loginError: error instanceof Error ? error.message : "恢复登录状态失败，请重新登录",
            session: persistedSession ? sanitizeSessionForPersist(persistedSession) : null,
          });
        }
      },
      saveServerConfig: (config) => {
        let primaryUrl = "";
        try {
          primaryUrl = normalizeServerBaseUrl(config.primaryUrl);
        } catch {
          primaryUrl = config.primaryUrl.trim();
        }

        set({
          serverConfig: {
            ...config,
            primaryUrl,
            fallbackUrls: config.fallbackUrls
              .map((u) => {
                try {
                  return normalizeServerBaseUrl(u);
                } catch {
                  return "";
                }
              })
              .filter(Boolean),
            name: config.name.trim() || config.username.trim() || "服务器",
            username: config.username.trim(),
          },
        });
      },
      clearServerConfig: () => {
        set({ serverConfig: null });
      },
      addFallbackUrl: (url) => {
        let trimmed = "";
        try {
          trimmed = normalizeServerBaseUrl(url);
        } catch {
          return;
        }
        if (!trimmed) return;
        set((state) => {
          if (!state.serverConfig) return state;
          if (state.serverConfig.fallbackUrls.includes(trimmed)) return state;
          if (state.serverConfig.primaryUrl === trimmed) return state;
          return {
            serverConfig: {
              ...state.serverConfig,
              fallbackUrls: [...state.serverConfig.fallbackUrls, trimmed],
            },
          };
        });
      },
      removeFallbackUrl: (url) => {
        set((state) => {
          if (!state.serverConfig) return state;
          return {
            serverConfig: {
              ...state.serverConfig,
              fallbackUrls: state.serverConfig.fallbackUrls.filter((u) => u !== url),
            },
          };
        });
      },
      switchActiveUrl: async (url) => {
        const state = get();
        if (!state.session) return false;
        let normalizedUrl = "";
        try {
          normalizedUrl = normalizeServerBaseUrl(url);
        } catch (error) {
          set({
            isLoggingIn: false,
            loginError: error instanceof Error ? error.message : "服务器地址格式不正确",
          });
          return false;
        }

        set({ isLoggingIn: true, loginError: null });

        try {
          const client = createSubsonicClient({
            baseUrl: normalizedUrl,
            username: state.session.username,
            password: state.session.password,
          });
          await client.ping();

          try {
            await saveSecureSession({ ...state.session, baseUrl: normalizedUrl });
          } catch (error) {
            console.warn(
              "[OtoMusic] failed to update secure credentials",
              error instanceof Error ? error.message : error,
            );
          }

          set({
            session: { ...state.session, baseUrl: normalizedUrl },
            isLoggingIn: false,
            loginError: null,
          });
          return true;
        } catch (error) {
          set({
            isLoggingIn: false,
            loginError: error instanceof Error ? error.message : "切换地址失败",
          });
          return false;
        }
      },
      autoSwitchActiveUrl: async () => {
        const state = get();
        if (!state.session) return false;

        try {
          const bestUrl = await selectBestReachableUrl(
            state.session,
            getServerConfigUrls(state.serverConfig, state.session.baseUrl),
          );

          if (bestUrl === state.session.baseUrl) {
            return true;
          }

          try {
            await saveSecureSession({ ...state.session, baseUrl: bestUrl });
          } catch (error) {
            console.warn(
              "[OtoMusic] failed to update secure credentials",
              error instanceof Error ? error.message : error,
            );
          }

          set({
            session: { ...state.session, baseUrl: bestUrl },
            loginError: null,
          });
          return true;
        } catch {
          return false;
        }
      },
      logout: () => {
        void clearSecureSession();
        set({
          session: null,
          isAuthenticated: false,
          isLoggingIn: false,
          isRestoringSession: false,
          loginError: null,
        });
      },
      clearLoginError: () => set({ loginError: null }),
    }),
    {
      name: "otomusic-auth",
      version: 2,
      partialize: (state) => ({
        session: sanitizeSessionForPersist(state.session),
        isAuthenticated: false,
        serverConfig: sanitizeServerConfigForPersist(state.serverConfig),
      }),
      migrate: (persisted: unknown, version: number) => {
        if (version === 0 && persisted && typeof persisted === "object") {
          const old = persisted as Record<string, unknown>;
          const savedServers = old.savedServers as Array<{
            name?: string;
            baseUrl?: string;
            username?: string;
            password?: string;
            apiKey?: string;
          }> | undefined;

          if (savedServers && savedServers.length > 0) {
            const first = savedServers[0];
            return {
              ...old,
              serverConfig: {
                name: first.name || first.username || "服务器",
                primaryUrl: first.baseUrl || "",
                fallbackUrls: savedServers.slice(1).map((s) => s.baseUrl || "").filter(Boolean),
                username: first.username || "",
                password: first.password || "",
                apiKey: first.apiKey,
              } satisfies ServerConfig,
              savedServers: undefined,
              activeServerId: undefined,
            };
          }

          return {
            ...old,
            serverConfig: null,
            savedServers: undefined,
            activeServerId: undefined,
          };
        }
        return persisted;
      },
    },
  ),
);
