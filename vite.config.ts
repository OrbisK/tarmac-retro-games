import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // The GitHub Pages project page this deploys to. An absolute base means the
  // build is tied to this one path — served from anywhere else, every asset
  // 404s — so a kiosk shell or a different subdirectory needs this changed (or
  // `"./"`, which resolves against whatever document loads it).
  base: "/tarmac-retro-games/",
  build: { target: "es2022" },
  server: { host: true },
  plugins: [
    VitePWA({
      // The cabinet has no network by design: everything the app needs is in
      // the bundle (no fonts, sprites or sounds are fetched at runtime), so a
      // precache of the build output is the whole offline story.
      strategies: "generateSW",
      // We register the worker ourselves from `core/pwa.ts`, because *when* an
      // update is applied matters on a cabinet — see that file.
      injectRegister: null,
      registerType: "prompt",
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        // A single-page app served from a relative base: any navigation
        // resolves to the one document.
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
        // Headroom over Workbox's 2 MiB default. Nothing in the build is
        // near it today, but a file over the cap is dropped from the
        // precache *silently* — on a machine whose whole point is running
        // with the network unplugged, that is the wrong failure mode.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
      },
      // `scope` and `start_url` stay relative even though `base` is not: they
      // resolve against the manifest's own URL, which already sits under the
      // base, so this is the same path by a shorter route.
      // No `id`: unlike every other URL here it resolves against the *origin*
      // rather than the manifest, so a relative one served from a
      // subdirectory would claim the origin root as this app's identity.
      // Left out, it defaults to `start_url`, which is the intent.
      manifest: {
        name: "Tarmac Retro Games",
        short_name: "Tarmac",
        description: "A 2-player arcade cabinet: one menu, several retro games.",
        start_url: "./",
        scope: "./",
        // Fullscreen first: the cabinet is the only thing on its monitor, and
        // a title bar would eat into the square play area.
        display: "fullscreen",
        display_override: ["fullscreen", "standalone"],
        orientation: "landscape",
        // The letterbox colour, so the shell matches the bars around the
        // play area rather than flashing white on launch.
        background_color: "#000000",
        theme_color: "#0b0b16",
        categories: ["games"],
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          // Padded copy for platforms that crop to their own shape.
          {
            src: "icons/maskable-640.png",
            sizes: "640x640",
            type: "image/png",
            purpose: "maskable",
          },
          { src: "icons/icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      // The worker is off in `vite dev` — a stale precache is exactly what you
      // do not want while editing. `npm run preview` serves the real thing.
      devOptions: { enabled: false },
    }),
  ],
});
