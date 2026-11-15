import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.ENCORE_API ?? "http://127.0.0.1:8889";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // File names changed from name-hash to name.hash on 15 Nov 2026 so browsers that had kept a 404 for an old name
  // (a deploy-time 404 cached for 4 hours) ask for new URLs.
  build: {
    rollupOptions: {
      output: { entryFileNames: "assets/[name].[hash].js", chunkFileNames: "assets/[name].[hash].js", assetFileNames: "assets/[name].[hash][extname]" },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 8888,
    strictPort: true,
    proxy: { "/api": api, "/callback": api, "^/s/": api },
  },
});
