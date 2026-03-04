import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Absolute base for GitHub Pages so assets always load from correct path.
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
