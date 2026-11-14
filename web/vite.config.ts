import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.ENCORE_API ?? "http://127.0.0.1:8889";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 8888,
    strictPort: true,
    proxy: { "/api": api, "/callback": api },
  },
});
