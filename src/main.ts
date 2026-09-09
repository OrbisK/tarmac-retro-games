import { k } from "./core/k";
import { installPwa } from "./core/pwa";
import { MENU_SCENE } from "./core/scene";
import { GAMES } from "./games/registry";
import { registerBindingSetup } from "./scenes/bindingSetup";
import { registerInputTest } from "./scenes/inputTest";
import { registerMenu } from "./scenes/menu";
import { registerOptions } from "./scenes/options";

/**
 * Boot: define every scene, then enter the menu.
 *
 * Scene *definition* is global and permanent; scene *contents* are rebuilt on
 * every entry. Nothing here installs per-frame handlers, because `go()` would
 * wipe them on the first transition — see `core/scene.ts`.
 *
 * The service worker goes in first so the very first visit is already caching
 * itself for the next one. It survives `go()` because it is not a KAPLAY
 * event — but it is also the only thing here that may reload the page, and it
 * never does so from boot: see `core/pwa.ts`.
 */
installPwa();

for (const game of GAMES) game.register();
registerMenu();
registerInputTest();
registerBindingSetup();
registerOptions();

k.go(MENU_SCENE);
