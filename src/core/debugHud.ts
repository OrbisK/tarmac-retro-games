import { DESIGN_HEIGHT, MAX_PLAYERS } from "./config";
import { k } from "./k";
import { BUTTONS, input } from "./input";
import { pendingCleanupCount } from "./lifecycle";
import { C, drawLabel, drawPanel, FONT_SMALL, measureLabel } from "./ui";

/**
 * Leak / performance overlay. Toggle with F3, or Back + Start together on a pad.
 *
 * The point of this is the long run: leave the cabinet cycling between games
 * for an hour and watch `obj` and `heap` come back to the same numbers. A
 * steadily climbing object count or high-water mark is the signal that
 * something is registering itself without cleaning up.
 *
 * All state is module-level so it survives scene changes, and every buffer is
 * preallocated so the monitor cannot itself be the leak.
 */

const SAMPLES = 64;
const SAMPLE_INTERVAL = 2;

const heapSamples = new Float32Array(SAMPLES);
let sampleCount = 0;
let sampleHead = 0;
let sampleTimer = SAMPLE_INTERVAL;

let visible = false;
/** Measured once: advance width of one glyph at FONT_SMALL. */
let charWidth = 0;
let sceneSwitches = 0;
let peakObjects = 0;
let peakHeapMb = 0;
let startTime = 0;

/** Reused every frame so drawing the overlay allocates nothing. */
const lines: string[] = [];
const held: string[] = [];

interface MemoryInfo {
  usedJSHeapSize: number;
}

/** Chrome-only, and only with precise values behind a flag. Best-effort. */
function heapMb(): number {
  const mem = (performance as Performance & { memory?: MemoryInfo }).memory;
  return mem ? mem.usedJSHeapSize / (1024 * 1024) : 0;
}

/** Called by the scene wrapper on every scene entry. */
export function noteSceneEntered(): void {
  sceneSwitches++;
  if (startTime === 0) startTime = performance.now();
}

function formatUptime(): string {
  const total = Math.floor((performance.now() - startTime) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function heapTrend(): string {
  if (sampleCount < 4) return "...";
  // Compare the mean of the oldest quarter with the newest quarter.
  const n = Math.min(sampleCount, SAMPLES);
  const q = Math.max(1, Math.floor(n / 4));
  const at = (i: number) => heapSamples[(sampleHead - n + i + SAMPLES * 2) % SAMPLES];
  let oldSum = 0;
  let newSum = 0;
  for (let i = 0; i < q; i++) {
    oldSum += at(i);
    newSum += at(n - 1 - i);
  }
  const delta = newSum / q - oldSum / q;
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}MB/${((n - 1) * SAMPLE_INTERVAL / 60).toFixed(0)}m`;
}

export function installDebugHud(): void {
  k.onKeyPress("f3", () => (visible = !visible));

  // Measure the font rather than assuming an advance width, so the panel
  // always fits its text. Re-measured per scene, since the window may have
  // been resized, but never per frame.
  {
    charWidth = measureLabel("0000000000", FONT_SMALL) / 10;
  }

  k.add([
    k.z(10_000),
    k.fixed(),
    {
      id: "debugHud",
      update() {
        // Pad shortcut: hold Back and tap Start.
        if (input.anyDown("back") && input.anyPressed("start")) visible = !visible;

        sampleTimer -= k.dt();
        if (sampleTimer <= 0) {
          sampleTimer = SAMPLE_INTERVAL;
          heapSamples[sampleHead] = heapMb();
          sampleHead = (sampleHead + 1) % SAMPLES;
          sampleCount++;
        }

        const objects = k.debug.numObjects();
        if (objects > peakObjects) peakObjects = objects;
        const mb = heapMb();
        if (mb > peakHeapMb) peakHeapMb = mb;
      },
      draw() {
        if (!visible) return;

        lines.length = 0;
        lines.push(`fps ${k.debug.fps()} dr ${k.debug.drawCalls()}`);
        lines.push(`obj ${k.debug.numObjects()} pk ${peakObjects}`);
        lines.push(`scn ${sceneSwitches} cln ${pendingCleanupCount()}`);
        lines.push(`pad ${input.padCount()} ${formatUptime()}`);

        const mb = heapMb();
        if (mb > 0) {
          lines.push(`mem ${mb.toFixed(1)} pk ${peakHeapMb.toFixed(1)}`);
          lines.push(heapTrend());
        } else {
          lines.push("mem n/a");
        }

        // Live input readout. Worth having on a cabinet: it shows at a glance
        // whether a controller is reporting input nobody is giving it.
        for (let p = 0; p < MAX_PLAYERS; p++) {
          held.length = 0;
          for (let i = 0; i < BUTTONS.length; i++) {
            if (input.down(p, BUTTONS[i])) held.push(BUTTONS[i]);
          }
          lines.push(`p${p + 1} ${held.length > 0 ? held.join(" ") : "-"}`);
        }

        let longest = 0;
        for (let i = 0; i < lines.length; i++) longest = Math.max(longest, lines[i].length);

        const lineH = FONT_SMALL + 2;
        const h = lines.length * lineH + 4;
        const w = Math.ceil(longest * charWidth) + 6;
        const x = 2;
        const y = DESIGN_HEIGHT - h - 2;

        drawPanel({ x, y, w, h, fill: C.black, outline: C.dim, fillOpacity: 0.85 });
        for (let i = 0; i < lines.length; i++) {
          drawLabel({
            text: lines[i],
            x: x + 3,
            y: y + 3 + i * lineH,
            size: FONT_SMALL,
            color: C.good,
          });
        }
      },
    },
  ]);
}
