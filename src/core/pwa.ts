import { registerSW } from "virtual:pwa-register";

/**
 * Offline install, and the one decision it forces: *when* to swap versions.
 *
 * Nothing in this app is fetched at runtime — no fonts, sprites or sounds, and
 * settings live in `localStorage` — so precaching the build output is enough
 * to make the cabinet work with the network unplugged, permanently. That part
 * is entirely the plugin's job (see `vite.config.ts`).
 *
 * What is not automatic is the update. A worker registered with
 * `registerType: "autoUpdate"` claims the page and reloads it the moment a new
 * build lands, which on a cabinet means a match can vanish mid-rally. So the
 * worker is registered in *prompt* mode and this module holds the new version
 * back until the machine is on the menu with nobody playing: `syncPwa` is
 * called on menu entry, and that is the only place a reload can happen.
 *
 * There is no prompt, despite the mode's name. Nobody at an arcade cabinet is
 * going to answer a dialog about service workers, and there is no need to ask:
 * between two games, a reload is indistinguishable from the menu redrawing.
 *
 * The update *check* rides on the same call, so there is no interval timer to
 * own — the cabinet returns to the menu constantly (a finished game, the idle
 * bail-out), which is a better cadence than any clock we would pick. It is
 * throttled so a room full of people browsing the carousel does not turn into
 * a request per card, and it fails silently when offline, which is the normal
 * case here.
 */

/** Skip waiting and reload. Undefined until a new build is actually waiting. */
let activate: ((reload?: boolean) => Promise<void>) | undefined;
let registration: ServiceWorkerRegistration | undefined;
let updateWaiting = false;
let lastCheck = 0;

/** Minimum gap between update checks, in ms. */
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Register the worker. Call once at boot, before the first scene.
 *
 * Safe to call in `vite dev`: the virtual module is a no-op stub there.
 */
export function installPwa(): void {
  const updateSW = registerSW({
    immediate: true,
    onRegisteredSW: (_swUrl, r) => {
      registration = r;
    },
    onNeedRefresh: () => {
      activate = updateSW;
      updateWaiting = true;
    },
    onRegisterError: (err) => console.error("[pwa] registration failed:", err),
  });
}

/**
 * Called on menu entry: apply a pending update, or look for one.
 *
 * Applying reloads the page, so nothing after this call in the same frame is
 * guaranteed to run — which is fine, the menu is about to be rebuilt from
 * scratch either way.
 */
export function syncPwa(): void {
  if (updateWaiting && activate) {
    // Clear first: the reload is asynchronous, and a second menu entry before
    // it lands must not queue another one.
    updateWaiting = false;
    const apply = activate;
    activate = undefined;
    void apply(true);
    return;
  }

  const now = Date.now();
  if (!registration || now - lastCheck < CHECK_INTERVAL_MS) return;
  lastCheck = now;
  // Rejects whenever there is no network, which is the point of all this.
  void registration.update().catch(() => {});
}

/**
 * One-word worker state for the debug HUD: whether this machine is actually
 * good for offline, and whether it is sitting on a new build.
 *
 * The strings are constants rather than built here, because the HUD draws
 * this every frame.
 */
export function pwaStatus(): string {
  if (updateWaiting) return "upd";
  return registration ? "ok" : "off";
}
