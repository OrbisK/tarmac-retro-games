import { DESIGN_HEIGHT, DESIGN_WIDTH, QUIT_HOLD_SECONDS } from "./config";
import { input } from "./input";
import { k } from "./k";
import { goToMenu } from "./scene";
import { drawHints } from "./prompts";
import { C, drawBar } from "./ui";

/**
 * "Hold Back to quit" for in-game scenes.
 *
 * A hold rather than a tap: on a shared cabinet an accidental Select press
 * shouldn't drop both players out of a match. Either player can trigger it.
 */
export function installQuitToMenu(): void {
  k.add([
    k.z(9_000),
    k.fixed(),
    {
      id: "quitToMenu",
      update() {
        if (input.maxHoldTime("back") >= QUIT_HOLD_SECONDS) goToMenu();
      },
      draw() {
        const held = input.maxHoldTime("back");
        if (held <= 0.05) return;
        const w = 56;
        const x = DESIGN_WIDTH - w - 4;
        const y = DESIGN_HEIGHT - 14;
        // Laid out through drawHints so the BACK box sizes itself to its text
        // instead of being positioned by a hand-tuned offset.
        drawHints({
          x: x - 4,
          y: y - 1,
          size: 12,
          align: "right",
          hints: [{ button: "back" }, { text: "QUIT" }],
        });
        drawBar({ x, y, w, h: 10, progress: held / QUIT_HOLD_SECONDS, color: C.bad });
      },
    },
  ]);
}
