import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import sourceLocator from "./plugins/source-locator";
import editorOverlay from "./plugins/editor-overlay";

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [sourceLocator(), react(), tailwindcss(), editorOverlay()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
    },
    watch: {
      // Fly Volume (NVMe) では inotify が効かないため polling を使う
      usePolling: true,
      interval: 1000,
    },
    hmr: {
      // Agent Server 経由でアクセスする場合の HMR WebSocket 設定
      // iframe 内から直接 Vite に接続する
      host: "localhost",
      port: 5173,
    },
  },
});
