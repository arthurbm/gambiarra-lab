import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development Vite serves the pages and forwards the API and the event
// stream to the world server. In production the world server serves `dist`.
const worldUrl = process.env.FREVO_WORLD_URL ?? "http://127.0.0.1:3200";

export default defineConfig({
  cacheDir: process.env.FREVO_WEB_CACHE_DIR || undefined,
  server: {
    host: process.env.FREVO_WEB_HOST || "0.0.0.0",
    port: Number(process.env.FREVO_WEB_PORT || 3201),
    strictPort: true,
    proxy: {
      "/api": worldUrl,
      "/events": worldUrl,
      "/health": worldUrl,
    },
  },
  plugins: [react()],
});
