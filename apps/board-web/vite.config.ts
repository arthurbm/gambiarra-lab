import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const boardProxyUrl = process.env.BOARD_PROXY_URL ?? "http://127.0.0.1:3001";
// The projector and participants expect 3002; scripts/event.ts overrides it
// for runs that must not collide with the event.
const webPort = Number(process.env.BOARD_WEB_PORT || 3002);

export default defineConfig({
  cacheDir: process.env.BOARD_WEB_CACHE_DIR || undefined,
  server: {
    host: process.env.BOARD_WEB_HOST || "0.0.0.0",
    port: webPort,
    strictPort: true,
    proxy: {
      "/api-reference": boardProxyUrl,
      "/events": boardProxyUrl,
      "/rpc": boardProxyUrl,
      "/tiles": boardProxyUrl,
    },
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
  ],
});
