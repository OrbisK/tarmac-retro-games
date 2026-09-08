# Tarmac Retro Games

A small arcade cabinet: one menu, several 2-player retro games, built on
[KAPLAY](https://kaplayjs.com/). Renders at the **monitor's own resolution**,
with a 4:3 layout letterboxed into the window.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle into dist/
npm run typecheck
```

## Controls

| Action | Player 1 pad | Player 2 pad | P1 keys | P2 keys |
| --- | --- | --- | --- | --- |
| Move | D-pad / left stick | D-pad / left stick | `WASD` | arrows |
| Confirm (A) | A / south | A / south | `Space` / `F` | `.` |
| Start | Start | Start | `Enter` | `Shift` |
| Quit to menu | hold Select 0.7s | hold Select 0.7s | hold `Esc` | hold `Backspace` |
| Debug overlay | hold Select + tap Start | " | `F3` | `F3` |
| Options / input test | see calibration below | " | `F5` / `F4` | `F5` / `F4` |

Either player can drive the menu. Pads are assigned to slots by their browser
gamepad index, lowest first.

Buttons are named by *action*, not by what is printed on the pad — logical `a`
is "confirm" wherever it physically sits. See calibration below.

## Calibrating a controller

On the menu, enter **Up Up Down Down Left Right Left Right** (`F4` on a
keyboard) to reach the hidden **input test** screen, then **Right** for
**button setup** or **Left** for **options** (`F5` goes straight there).

Both screens are navigated with **directions only**, on purpose: the reason
you are on them is that the face buttons may be reporting the wrong indices,
so the way in must not depend on a face button working.

Defaults for a pad with no declared mapping match the cabinet's SNES-style
diamond, measured on the hardware: **B0 = X** (blue, top), **B1 = A** (red,
right), **B2 = B** (yellow, bottom), **B3 = Y** (green, left) — so logical `a`
(confirm) is the red button. Pads that report `mapping: "standard"` keep the
W3C order instead, where button 0 is the bottom face button; using the cabinet
layout there would put `a` on the right face button of an Xbox-style pad.
`l`/`r`/`start`/`back` are still educated guesses on an unmapped pad — worth
confirming on the input test screen.

**Input test** shows what the hardware actually reports — a lamp per raw
button index, a bar per axis, and the logical actions those currently resolve
to. To identify a mystery pad: press the button you call "A" and read which
`B<n>` lights up.

**Button setup** rebinds one action at a time.

| Key | Action |
| --- | --- |
| Up / Down | pick a row |
| Right | rebind — then press the physical button or axis you want |
| Left | put that row back to its default |
| L | back to the input test |
| hold Back | menu |

The top row picks the device: each connected pad, plus each player's keyboard.
Gamepad bindings save against the controller's **`id` string**, not the player
slot — so calibrating one of a pair of identical pads fixes both, and a
different controller keeps its own layout. Bindings live in `localStorage`
under `tarmac.bindings.v1`; overrides are merged over the defaults, so a
half-calibrated pad still works for every action you did not touch.

Left restores a row's default rather than emptying it — clearing `up` outright
would leave the list unnavigable.

## Options

**Left** from the input test, or `F5` from the menu. Directions only, for the
same reason as the other two screens: it has to be usable on a pad whose face
buttons report the wrong indices.

| Key | Action |
| --- | --- |
| Up / Down | pick a row |
| Left / Right | change the game scale |
| Right | on the reset row, restore defaults |
| L | back to the input test |
| hold Back | menu |

One setting so far, **game scale** — see below. Each game draws its own sample
underneath at true size, so the effect is visible without launching a match.
Settings live in `localStorage` under `tarmac.settings.v1`.

## Layout

```
src/
  main.ts              boot: register scenes, enter the menu
  core/
    config.ts          resolution, palette, tuning constants (pure data)
    k.ts               the single KAPLAY context
    scene.ts           defineScene() / goTo() — every scene goes through here
    lifecycle.ts       scene-scoped cleanup registry
    input.ts           2-player input over gamepads + keyboard
    ui.ts              palette Colors and pixel-snapped draw helpers
    pool.ts            fixed-capacity object pool for transient effects
    quit.ts            hold-to-quit-to-menu shell for in-game scenes
    game.ts            GameDefinition — the contract a game implements
    debugHud.ts        F3 overlay: fps, object count, heap trend, live input
    buttons.ts         the logical button vocabulary games code against
    bindings.ts        per-controller button bindings + localStorage
    settings.ts        game scale + localStorage
    cheat.ts           hidden button-sequence matcher
  games/
    registry.ts        the menu's game list
    pong.ts
    snakeDuel.ts
  scenes/
    menu.ts
    inputTest.ts       live raw button/axis readout
    bindingSetup.ts    rebinding screen
    options.ts         game scale, with a live sample per game
```

## Design rules

Two constraints apply to everything in here, including new games:

**Design in low resolution.** The 320x240 design space is the authority for
every layout and gameplay decision — chunky shapes, few text sizes, no detail
finer than about one design unit. Rendering at native resolution makes it
*sharp*, not *detailed*: adding sub-unit detail because the panel can show it
looks wrong next to everything else and disappears at viewing distance.
Minimums: text 10 units, hairlines 1 unit, status marks 5 units square.

**Always high contrast.** Every colour used for text is 6.5:1 or better
against `bg`, and the border grey clears 4:1; the figures are listed above
`PALETTE` in `core/config.ts`. Check new colours against `bg` before using
them for anything a player reads, and don't encode state as dim-vs-bright
alone at this size.

## Resolution and scaling

There is no internal low-resolution framebuffer. The canvas fills the window at
device resolution (`devicePixelRatio` included), so output is limited by the
monitor and nothing is ever rendered small and blown up.

What is fixed is the *proportions*. `DESIGN_WIDTH x DESIGN_HEIGHT` in
`core/config.ts` (320x240) defines a **design-unit** space: a 4:3 box is fitted
into the window, `core/viewport.ts` works out how many device pixels one unit
is worth, and every draw call converts. A 4-unit ball is 4 units on a 640x480
panel and on a 4K one — sharp on both, because text is rasterised at its final
pixel size rather than scaled up from a small atlas.

All gameplay tuning (speeds, sizes, grid cells) is in design units, so raising
the design numbers rescales the whole cabinet — finer detail, proportionally
smaller UI — without touching a single game.

**The one rule this imposes:** draw through the helpers in `core/ui.ts`
(`drawBox`, `drawLabel`, `drawPanel`, `drawDot`, `drawTriangle`, `drawRule`,
`drawBar`, `drawDottedColumn`). They take design units and convert. Calling
`k.drawRect` or `k.drawText` directly still compiles, but the shape lands in
raw device pixels and ignores the viewport — the one class of mistake here that
typechecking will not catch. Camera-space effects need converting too, which is
why the shake calls read `k.shake(pu(...))`.

Non-4:3 windows get black bars rather than a stretched or re-flowed layout. On
a 4:3 cabinet monitor that is a no-op; letting layouts adapt to arbitrary
aspect ratios would be per-game work.

### Game scale

Sharp is not the same as legible. At cabinet distance the design baselines hold
up for anything you read standing still, and lose for the two things you track
with your hands busy: the Pong ball and a countdown. **Game scale** in the
options screen multiplies those — `1x`, `1.25x` (default), `1.5x`, `1.75x`,
`2x`.

What it does **not** do is zoom the design box. 320x240 stays the layout
authority, the Pong court keeps its dimensions and all of its speeds, and the
menu and chrome are untouched. Only the elements a game declares as
scale-sensitive grow, so raising the scale trades board area for chunk:

| | 1x | 2x |
| --- | --- | --- |
| Pong ball | 4 | 8 |
| Pong paddle | 4x30 | 8x60 |
| Snake cell | 8 (40x28 board) | 16 (20x14 board) |
| Countdown text | 28 | 56 |

Steps are discrete because at this resolution a factor of 1.07 buys nothing
anyone can see, and Snake's board has to land on a whole number of cells.

**For game code:** keep tuning the *baseline* numbers, and draw with
`scaleUnits(BASE)` from `core/settings.ts` for the handful that should follow
the setting — read at scene entry, never per frame, because the value must not
change under a match in progress. What to scale is a judgement per game:
element sizes and short in-game numerals, yes; court dimensions, speeds and
tick rates, no, or the pace changes with the setting. Anything preallocated
from a grid size (Snake's ring buffers) sizes itself from `GAME_SCALE_MIN`, so
one allocation covers every scale.

### Adding a game

1. Write `src/games/yourGame.ts` exporting a `GameDefinition` whose
   `register()` calls `defineScene(id, body)`.
2. Add it to `GAMES` in `src/games/registry.ts`.

Nothing else changes — the menu builds itself from the registry, including the
optional animated `drawPreview` thumbnail, and the options screen picks up the
optional `drawScaleSample` the same way.

## Keeping it leak-free

The cabinet is expected to stay on for hours and cycle between games hundreds
of times, so the rules below are load-bearing rather than stylistic.

**KAPLAY's `go()` clears more than it looks like it does.** It calls
`app.events.clear()`, `game.events.clear()`, `game.objEvents.clear()` and
removes all root children. Two consequences:

- Anything registered *outside* a scene body is silently gone after the first
  transition. So per-frame systems are installed by `defineScene` on **every**
  scene entry, and die with the scene. Never install a global `onUpdate`.
- Two `go()` calls in one frame would queue two scene bodies and run both,
  duplicating every object and timer. `goTo()` makes the first call of a frame
  win — always use it instead of `k.go`.

**Rules for game code:**

- Register cleanup for anything KAPLAY doesn't own — DOM listeners, raw
  timers, buffers — with `onCleanup()` from `core/lifecycle.ts`. Prefer the
  wrappers `later()`, `every()` and `onWindowEvent()`, which register it for
  you. Never use `setTimeout` / `setInterval` / bare `addEventListener`.
- Never call `k.onGamepadConnect` / `onGamepadDisconnect`: they return `void`,
  so they cannot be unregistered, and a per-scene call leaks one handler per
  entry. Poll instead — `core/input.ts` does.
- Load assets once at boot, never per round. Fonts, sprites and shaders are
  cached globally by KAPLAY and are not scene-scoped.
- Don't allocate in `onDraw`/`onUpdate`. Build `Color`s, arrays and option
  objects once. `Color.lerp` and friends allocate.
- For transient effects use `makePool()` rather than spawning objects. Its
  capacity is fixed, so a runaway spawn rate degrades visually instead of
  eating memory (see the hit sparks in `pong.ts`).
- For anything numerous and uniform — grid cells, snake segments — keep state
  in preallocated typed arrays and paint it in one `onDraw`, instead of one
  game object per cell (see `snakeDuel.ts`).

## Menu

The menu is a full-bleed carousel: one game per card, **left/right** to
browse, A/Start to launch. Up/down do the same thing, because people try them
on a d-pad.

Cards sit on an endless track indexed by a *virtual* index free to run
negative or past the end — the game shown is that index modulo the list
length. That is what makes wrapping from the last game to the first slide
continuously instead of rewinding across the whole track. At most three cards
are drawn during a slide and one when settled, and `drawLetterboxBars()` runs
last to clip whatever slid past the design box.

Each game's `drawPreview(x, y, w, h, t)` fills the card's banner. Previews must
size everything from the box they are handed — the same function is drawn
small and near-fullscreen — and must not allocate or add objects.

**Verifying it.** Press `F3` and read `obj` and `mem`. Leave the cabinet
cycling and both should return to the same numbers; a monotonically climbing
`obj` or `mem` trend means something is registering without cleaning up.

Measured on this build: **811 scene transitions** left the object count flat
and the post-GC heap within ~1.5 MB of a fresh load — KAPLAY's glyph atlas
warming up, which plateaus rather than growing. An ~80-transition cycle through
all five scenes moves the post-GC heap by ~0.3 MB.

One caveat specific to resolution independence: KAPLAY caches a glyph atlas per
(font, pixel size), so each distinct window size warms a new set. Sweeping 20
window sizes added ~2 MB of JS heap, which came back on returning to the
original size — and atlas *textures* live in GPU memory, which
`performance.memory` cannot see. A fixed display only ever uses one size, so
this affects development, not the cabinet.

## Input notes

`core/input.ts` deliberately does not use KAPLAY's gamepad or keyboard state:

- **Gamepads** are read straight from `navigator.getGamepads()` against the
  bindings in `core/bindings.ts`. KAPLAY resolves its semantic button names
  ("south", "dpad-up", ...) through a table keyed on the pad's `id` string and
  falls back to a default — which is a guess for any pad reporting
  `mapping: ""`, as the cheap USB pads on this cabinet do (two axes, ten
  buttons, d-pad on axes 0/1). Reading indices ourselves is deterministic, and
  when the guess is wrong the setup screen fixes it instead of a code change.
- **Keyboard** state is tracked by this module's own listeners. KAPLAY defers
  key handling to a per-frame `app.events` one-shot, and `go()` clears
  `app.events` — so a keyup that lands during a scene transition can be
  dropped, leaving the key stuck down for the rest of the session. Owning the
  listeners also lets us clear held keys on `blur` and `visibilitychange`.

`axisX`/`axisY` read the strength of whichever bound axis is pushed furthest
and fall back to the digital direction buttons, so a game gets smooth analog
movement on a stick and full-speed movement on a d-pad without caring which
it is on.

A pad that has just appeared is ignored for 3 frames (`PAD_SETTLE_FRAMES`):
cheap pads can report garbage on their first poll, which would otherwise read
as a real press and launch a game the moment someone plugs a controller in.
For the same reason, binding capture compares against the pad's *resting*
state rather than against zero, so an off-centre stick does not bind itself.

Rebinding has one non-obvious hazard, handled in `bindingSetup.ts`: the moment
you bind a still-held input to an action, that action sees a fresh press edge
on the next frame, which would immediately re-trigger whatever it does.
Setup ignores input for `POST_BIND_LOCK` seconds after a bind to swallow it.

Buttons are polled once per frame and edge-detected from our own previous
state, so a press shorter than one frame (~16ms) is not seen. That is below
human range and gamepads are polled anyway, but it is why synthetic
`keydown`+`keyup` pairs in the same tick appear to do nothing.
