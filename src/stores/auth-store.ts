import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createSubsonicClient } from "@/lib/api/client";

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
  loginError: string | null;
  serverConfig: ServerConfig | null;
  login: (session: AuthSession) => Promise<boolean>;
  saveServerConfig: (config: ServerConfig) => void;
  clearServerConfig: () => void;
  addFallbackUrl: (url: string) => void;
  removeFallbackUrl: (url: string) => void;
  switchActiveUrl: (url: string) => Promise<boolean>;
  logout: () => void;
  clearLoginError: () => void;
};

function normalizeSession(session: AuthSession): AuthSession {
  return {
    baseUrl: session.baseUrl.trim(),
    username: session.username.trim(),
    password: session.password,
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

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,
      isAuthenticated: false,
      isLoggingIn: false,
      loginError: null,
      serverConfig: null,
      login: async (session) => {
        const normalized = normalizeSession(session);

        if (!normalized.baseUrl || !normalized.username || !normalized.password) {
          set({ loginError: "请完整填写地址、用户名和密码" });
          return false;
        }

        set({ isLoggingIn: true, loginError: null });

        const urlsToTry = [normalized.baseUrl];
        const config = get().serverConfig;
        if (config) {
          for (const fallback of config.fallbackUrls) {
            if (!urlsToTry.includes(fallback)) {
              urlsToTry.push(fallback);
            }
          }
          if (!urlsToTry.includes(config.primaryUrl)) {
            urlsToTry.push(config.primaryUrl);
          }
        }

        let lastError: unknown = null;

        for (const url of urlsToTry) {
          try {
            const client = createSubsonicClient({
              ...normalized,
              baseUrl: url,
            });
            await client.ping();

            set({
              session: { ...normalized, baseUrl: url },
              isAuthenticated: true,
              isLoggingIn: false,
              loginError: null,
            });

            return true;
          } catch (error) {
            lastError = error;
            if (!isNetworkError(error)) {
              break;
            }
          }
        }

        set((state) => ({
          isLoggingIn: false,
          isAuthenticated: state.isAuthenticated,
          session: state.session,
          loginError:
            lastError instanceof Error ? lastError.message : "登录失败，请检查服务器地址与账号信息",
        }));
        return false;
      },
      saveServerConfig: (config) => {
        set({
          serverConfig: {
            ...config,
            primaryUrl: config.primaryUrl.trim(),
            fallbackUrls: config.fallbackUrls.map((u) => u.trim()).filter(Boolean),
            name: config.name.trim() || config.username.trim() || "服务器",
            username: config.username.trim(),
          },
        });
      },
      clearServerConfig: () => {
        set({ serverConfig: null });
      },
      addFallbackUrl: (url) => {
        const trimmed = url.trim();
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

        set({ isLoggingIn: true, loginError: null });

        try {
          const client = createSubsonicClient({
            baseUrl: url,
            username: state.session.username,
            password: state.session.password,
          });
          await client.ping();

          set({
            session: { ...state.session, baseUrl: url },
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
      logout: () => {
        set({
          session: null,
          isAuthenticated: false,
          isLoggingIn: false,
          loginError: null,
        });
      },
      clearLoginError: () => set({ loginError: null }),
    }),
    {
      name: "otomusic-auth",
      version: 1,
      partialize: (state) => ({
        session: state.session,
        isAuthenticated: state.isAuthenticated,
        serverConfig: state.serverConfig,
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
