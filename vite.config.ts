import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// single source of truth for the version shown in the app
const { version } = JSON.parse(readFileSync("./package.json", "utf-8"));

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  define: {
    __APP_VERSION__: JSON.stringify(version),
  },

  build: {
    // The renderer loads from disk, but splitting the two big vendors out
    // still helps: they parse in parallel with app code and stay
    // byte-identical between releases.
    rollupOptions: {
      output: {
        manualChunks: {
          pixi: ["pixi.js"],
          react: ["react", "react-dom", "motion/react"],
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
