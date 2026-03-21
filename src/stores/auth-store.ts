import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createSubsonicClient } from "@/lib/api/client";

export type AuthSession = {
  baseUrl: string;
  username: string;
  password: string;
};

type AuthState = {
  session: AuthSession | null;
  isAuthenticated: boolean;
  isLoggingIn: boolean;
  loginError: string | null;
  login: (session: AuthSession) => Promise<boolean>;
  logout: () => void;
  clearLoginError: () => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      session: null,
      isAuthenticated: false,
      isLoggingIn: false,
      loginError: null,
      login: async (session) => {
        const normalized: AuthSession = {
          baseUrl: session.baseUrl.trim(),
          username: session.username.trim(),
          password: session.password,
        };

        if (!normalized.baseUrl || !normalized.username || !normalized.password) {
          set({ loginError: "请完整填写地址、用户名和密码" });
          return false;
        }

        set({ isLoggingIn: true, loginError: null });

        try {
          const client = createSubsonicClient(normalized);
          await client.ping();

          set({
            session: normalized,
            isAuthenticated: true,
            isLoggingIn: false,
            loginError: null,
          });
          return true;
        } catch (error) {
          set({
            isLoggingIn: false,
            isAuthenticated: false,
            loginError:
              error instanceof Error ? error.message : "登录失败，请检查服务器地址与账号信息",
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
      partialize: (state) => ({
        session: state.session,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
