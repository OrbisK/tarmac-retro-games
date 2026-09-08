import type { KEventController } from "kaplay";
import { k } from "./k";

/**
 * Scene-scoped cleanup registry.
 *
 * KAPLAY's `go()` already wipes root events, input handlers and scene objects,
 * but it knows nothing about resources *we* create: DOM listeners, raw
 * timers, pooled buffers, AudioContext nodes. Anything like that must be
 * registered here so it is released when the scene is left.
 *
 * Only ever one scope is active (the current scene), so a module-level array
 * is enough and costs no allocation per registration.
 */

type Disposer = () => void;

const disposers: Disposer[] = [];

/** Run `fn` when the current scene is left. */
export function onCleanup(fn: Disposer): void {
  disposers.push(fn);
}

/** Called by the scene wrapper on scene leave. Never call this directly. */
export function runCleanups(): void {
  // Reverse order, so teardown mirrors setup.
  for (let i = disposers.length - 1; i >= 0; i--) {
    try {
      disposers[i]();
    } catch (err) {
      console.error("[lifecycle] cleanup failed:", err);
    }
  }
  disposers.length = 0;
}

/** How many disposers the current scene holds — surfaced in the debug HUD. */
export function pendingCleanupCount(): number {
  return disposers.length;
}

/** Track a KAPLAY event controller so it is cancelled on scene leave. */
export function track<T extends KEventController>(ev: T): T {
  onCleanup(() => ev.cancel());
  return ev;
}

/**
 * `k.wait`, but explicitly cancelled on scene leave.
 * Use this instead of `setTimeout` — it respects pause and time scale.
 */
export function later(seconds: number, action: () => void): KEventController {
  return track(k.wait(seconds, action));
}

/** `k.loop`, but explicitly cancelled on scene leave. Never use `setInterval`. */
export function every(seconds: number, action: () => void): KEventController {
  return track(k.loop(seconds, action));
}

/** `addEventListener` with automatic removal on scene leave. */
export function onWindowEvent<Type extends keyof WindowEventMap>(
  type: Type,
  handler: (ev: WindowEventMap[Type]) => void,
  options?: AddEventListenerOptions,
): void {
  window.addEventListener(type, handler as EventListener, options);
  onCleanup(() => window.removeEventListener(type, handler as EventListener, options));
}
