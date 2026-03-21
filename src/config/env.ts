export const envDefaults = {
  subsonicBaseUrl: import.meta.env.VITE_SUBSONIC_BASE_URL?.trim() ?? "",
  subsonicUsername: import.meta.env.VITE_SUBSONIC_USERNAME?.trim() ?? "",
  subsonicPassword: import.meta.env.VITE_SUBSONIC_PASSWORD?.trim() ?? "",
};
