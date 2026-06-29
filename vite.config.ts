import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and ignores the dev server's host env in CI.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Don't watch src-tauri/ — cargo writes .pdb / .lock files there that
    // are briefly locked by link.exe on Windows, which crashes vite's
    // chokidar with EBUSY. (Tauri rebuilds on Rust changes itself, so vite
    // never needed to watch it anyway.)
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "es2021",
    outDir: "dist",
  },
});
