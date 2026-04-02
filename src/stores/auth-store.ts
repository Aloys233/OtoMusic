import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createSubsonicClient } from "@/lib/api/client";

export type AuthSession = {
  baseUrl: string;
  username: string;
  password: string;
};

export type SavedServerProfile = {
  id: string;
  name: string;
  baseUrl: string;
  username: string;
  password: string;
  apiKey?: string;
  lastConnectedAt: number;
};

type AuthState = {
  session: AuthSession | null;
  isAuthenticated: boolean;
  isLoggingIn: boolean;
  loginError: string | null;
  savedServers: SavedServerProfile[];
  activeServerId: string | null;
  login: (session: AuthSession) => Promise<boolean>;
  saveServerProfile: (profile: Omit<SavedServerProfile, "id" | "lastConnectedAt"> & { id?: string }) => string;
  removeServerProfile: (id: string) => void;
  connectServerProfile: (id: string) => Promise<boolean>;
  setActiveServerId: (id: string | null) => void;
  logout: () => void;
  clearLoginError: () => void;
};

function createServerId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `srv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSession(session: AuthSession): AuthSession {
  return {
    baseUrl: session.baseUrl.trim(),
    username: session.username.trim(),
    password: session.password,
  };
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,
      isAuthenticated: false,
      isLoggingIn: false,
      loginError: null,
      savedServers: [],
      activeServerId: null,
      login: async (session) => {
        const normalized = normalizeSession(session);

        if (!normalized.baseUrl || !normalized.username || !normalized.password) {
          set({ loginError: "请完整填写地址、用户名和密码" });
          return false;
        }

        set({ isLoggingIn: true, loginError: null });

        try {
          const client = createSubsonicClient(normalized);
          await client.ping();

          let activeServerId: string | null = null;
          set((state) => {
            const matchedServer = state.savedServers.find(
              (server) =>
                server.baseUrl === normalized.baseUrl && server.username === normalized.username,
            );
            activeServerId = matchedServer?.id ?? state.activeServerId;

            if (!matchedServer) {
              return {
                session: normalized,
                isAuthenticated: true,
                isLoggingIn: false,
                loginError: null,
                activeServerId,
              };
            }

            return {
              session: normalized,
              isAuthenticated: true,
              isLoggingIn: false,
              loginError: null,
              activeServerId,
              savedServers: state.savedServers.map((server) =>
                server.id === matchedServer.id
                  ? {
                      ...server,
                      password: normalized.password,
                      lastConnectedAt: Date.now(),
                    }
                  : server),
            };
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
      saveServerProfile: (profile) => {
        const baseUrl = profile.baseUrl.trim();
        const username = profile.username.trim();
        const password = profile.password;
        const name = profile.name.trim() || username || "服务器";
        const id = profile.id?.trim() || createServerId();

        if (!baseUrl || !username || !password) {
          return "";
        }

        set((state) => {
          const nextServer: SavedServerProfile = {
            id,
            name,
            baseUrl,
            username,
            password,
            apiKey: profile.apiKey?.trim() || undefined,
            lastConnectedAt: Date.now(),
          };
          const exists = state.savedServers.some((server) => server.id === id);
          return {
            savedServers: exists
              ? state.savedServers.map((server) => (server.id === id ? nextServer : server))
              : [nextServer, ...state.savedServers],
          };
        });

        return id;
      },
      removeServerProfile: (id) => {
        set((state) => ({
          savedServers: state.savedServers.filter((server) => server.id !== id),
          activeServerId: state.activeServerId === id ? null : state.activeServerId,
        }));
      },
      connectServerProfile: async (id) => {
        const profile = get().savedServers.find((server) => server.id === id);
        if (!profile) {
          set({ loginError: "未找到该服务器配置" });
          return false;
        }

        const connected = await get().login({
          baseUrl: profile.baseUrl,
          username: profile.username,
          password: profile.password,
        });
        if (!connected) {
          return false;
        }

        set((state) => ({
          activeServerId: id,
          savedServers: state.savedServers.map((server) =>
            server.id === id
              ? {
                  ...server,
                  lastConnectedAt: Date.now(),
                }
              : server),
        }));
        return true;
      },
      setActiveServerId: (activeServerId) => set({ activeServerId }),
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
      partialize: (state) => ({
        session: state.session,
        isAuthenticated: state.isAuthenticated,
        savedServers: state.savedServers,
        activeServerId: state.activeServerId,
      }),
    },
  ),
);
