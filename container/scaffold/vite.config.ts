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
  },
});
