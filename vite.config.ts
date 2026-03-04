import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages: set base to /repo-name/ so assets load correctly.
// For local dev use npm run dev (base is /).
export default defineConfig({
  plugins: [react()],
  base: "/twitter-sync-bot/",
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
