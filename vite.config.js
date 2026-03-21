var _a;
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import electron from "vite-plugin-electron/simple";
var appVersion = (_a = process.env.npm_package_version) !== null && _a !== void 0 ? _a : "0.0.0";
export default defineConfig({
    plugins: [
        react(),
        electron({
            main: {
                entry: "electron/main.ts",
            },
            preload: {
                input: "electron/preload.ts",
            },
            renderer: {},
        }),
    ],
    define: {
        __APP_VERSION__: JSON.stringify(appVersion),
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
});
