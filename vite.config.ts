import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the build can be dropped into any subdirectory / kiosk shell.
  base: "./",
  build: { target: "es2022" },
  server: { host: true },
});
