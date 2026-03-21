import { create } from "zustand";
import { persist } from "zustand/middleware";

type SettingsState = {
  outputDeviceId: string;
  preampGainDb: number;
  setOutputDeviceId: (deviceId: string) => void;
  setPreampGainDb: (gain: number) => void;
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      outputDeviceId: "default",
      preampGainDb: 0,
      setOutputDeviceId: (outputDeviceId) => set({ outputDeviceId }),
      setPreampGainDb: (preampGainDb) =>
        set({ preampGainDb: Math.max(-12, Math.min(12, preampGainDb)) }),
    }),
    {
      name: "otomusic-settings",
      partialize: (state) => ({
        outputDeviceId: state.outputDeviceId,
        preampGainDb: state.preampGainDb,
      }),
    },
  ),
);
