import { k } from "./k";
import { input } from "./input";
import { installDebugHud, noteSceneEntered } from "./debugHud";
import { runCleanups } from "./lifecycle";
import { drawBackdrop } from "./ui";
import { updateViewport } from "./viewport";

/**
 * Scene registration and transitions.
 *
 * Why every scene has to go through here: KAPLAY's `go()` calls
 * `app.events.clear()`, `game.events.clear()` and removes all root children.
 * That means *nothing* registered outside a scene body survives a transition —
 * a global `onUpdate` installed at boot is silently gone after the first
 * `go()`. So per-frame systems (input polling, the debug HUD) are installed by
 * this wrapper on every scene entry, and torn down with the scene.
 *
 * It also owns the frame's two shared steps: refreshing the viewport (so the
 * design-unit -> pixel mapping is current before anything reads it) and
 * painting the letterboxed play area. Root draw events run before children, so
 * registering the backdrop before the scene body puts it underneath.
 */

/**
 * `go()` defers the switch to `frameEnd`. Two calls in the same frame would
 * queue two scene bodies and run both — duplicate objects, duplicate timers.
 * This flag makes the first transition of a frame win.
 */
let transitionPending = false;

export type SceneBody = (...args: never[]) => void;

export function defineScene<Args extends unknown[]>(
  name: string,
  body: (...args: Args) => void,
): void {
  k.scene(name, (...args: Args) => {
    transitionPending = false;
    noteSceneEntered();

    // Before the body, so anything it measures at construction sees real sizes.
    updateViewport();

    // Registered first, so these run before any game logic this frame.
    k.onUpdate(() => {
      updateViewport();
      input.poll();
    });
    k.onDraw(() => drawBackdrop());
    // Fires before KAPLAY tears the scene down, so disposers still see state.
    k.onSceneLeave(() => runCleanups());

    body(...args);

    installDebugHud();
  });
}

/** Switch scenes. Always use this instead of `k.go`. */
export function goTo(name: string, ...args: unknown[]): void {
  if (transitionPending) return;
  transitionPending = true;
  k.go(name, ...args);
}

export const MENU_SCENE = "menu";
export const INPUT_TEST_SCENE = "input-test";
export const BINDINGS_SCENE = "bindings";
export const OPTIONS_SCENE = "options";

export function goToMenu(): void {
  goTo(MENU_SCENE);
}
