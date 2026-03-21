import { SubsonicClient, type SubsonicClientConfig } from "./subsonic-client";

export function createSubsonicClient(config: SubsonicClientConfig) {
  return new SubsonicClient({
    ...config,
    clientName: config.clientName ?? "OtoMusic",
    apiVersion: config.apiVersion ?? "1.16.1",
  });
}
