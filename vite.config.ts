import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so assets load correctly on GitHub Pages (e.g. .../twitter-sync-bot/).
export default defineConfig({
  plugins: [react()],
  base: "./",
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
