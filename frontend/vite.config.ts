import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: ".",
  resolve: {
    alias: {
      "@typechain": resolve(__dirname, "../typechain-types"),
    },
  },
  build: {
    outDir: "dist",
  },
  server: {
    port: 5173,
    open: true,
  },
});
