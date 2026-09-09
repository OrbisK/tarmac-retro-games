# Tarmac Retro Games

A small arcade cabinet: one menu, several 2-player retro games, built on
[KAPLAY](https://kaplayjs.com/). Renders at the **monitor's own resolution**,
with a 4:3 layout letterboxed into the window.

```bash
npm install
npm run dev        # http://localhost:5173/tarmac-retro-games/
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
| Controls modal (menu) | Y | Y | `E` | `/` |
| Debug overlay | hold Select + tap Start | " | `F3` | `F3` |
| Options / input test | see calibration below | " | `F5` / `F4` | `F5` / `F4` |
| Cancel the idle timeout | anything at all | " | any key | any key |

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
| Left / Right | change the game scale, or the idle timeout |
| Right | enter a game row, or restore defaults on the reset row |
| L | back to the input test |
| hold Back | menu |

**Game scale** is the first row — see below. Each game draws its own sample
underneath at true size, so the effect is visible without launching a match.
The strip holds three panels and windows across the registry, centred on the
last game row the cursor visited and outlined in that game's accent — a panel
narrow enough to fit every game at once is too narrow to read, and the
registry only grows.

**Idle timeout** is the second: how long a screen sits untouched before the
cabinet takes itself back to the menu — `OFF`, `30S`, `45S`, `1M` (the
default), `1M 30S`, `2M`, `3M`, `5M`. It applies immediately, including to the
options screen you set it on, and the pips light with the length, so `OFF`
lights none and shows red. See below.

Both live in `localStorage` under `tarmac.settings.v1`.

Then one row per game: whether it plays and from when, below. The reset row
restores all of it — the scale, the timeout, every unlock time and every game
switched back on — and says `CHANGED` whenever any of them is off its default.

## Which games play, and when

Each game's row on the options screen is the whole answer:

```
PONG          TIMED  9 SEP 2026 20:00                 3D 01H
SNAKE DUEL    ON     9 SEP 2026 18:00                   OPEN
TARMAC BRAWL  OFF    9 SEP 2026 18:00                 HIDDEN
```

Left to right: the game's **state**, a release timestamp field by field, and
what that means right now.

The state has three positions, and it is one field rather than two switches
because there is one question being answered per game:

| State | Meaning |
| --- | --- |
| `OFF` | not on the cabinet at all — no card, no dot, no place in the carousel |
| `ON` | playable now (the default) |
| `TIMED` | playable from the timestamp on the row; locked, with a countdown, until then |

`OFF` is for a game that is **broken**: the controller input for it is dead,
it crashes on the third round, whatever it is — take it off until you can fix
it. It is deliberately not a locked card. A locked card is an advert with a
countdown on it and something to come back for; a broken game has neither, and
a card that only ever refuses would just collect presses all day. So it is
gone from the carousel entirely, and the footer dots and the wrap-around count
only the games that are actually on offer.

Switch **every** game off and the menu says so, in place of the carousel:

```
        NO GAMES ENABLED
   EVERY GAME ON THIS CABINET IS
    SWITCHED OFF IN OPTIONS  (F5)
```

That state can only be reached from the options screen, so the notice is
addressed to whoever made it rather than apologising to a player. The menu has
no idle timeout, so the cabinet sits there until a game goes back on — `F5`,
or the reset row, which puts them all back.

`TIMED` holds a game back until a moment you set, so an event can drop games
over the course of a day. Until then the menu shows the card as `???` over a
dimmed preview with a live countdown, and refuses to launch it.

The right-hand column is the consequence, not the setting: `HIDDEN`, `OPEN`,
or the countdown a player will see. That countdown is also the check on the
cabinet's clock — if it reads wrong here, the machine's own time is wrong. A
row that is not `TIMED` keeps its timestamp, dimmed, so a schedule can be set
up before it is armed, or while the game is still switched off.

Editing a row, with four directions and no confirm button:

| Key | Action |
| --- | --- |
| Right | enter the row, on the state field |
| Left / Right | move between fields |
| Up / Down | change the field under the cursor |
| Left, on the state field | leave the row |

Up/Down are the row picker until you enter a row and the value knob after,
which is the only way to fit a timestamp editor into direction-only
navigation. Values auto-repeat when held, and they carry: minute 59 stepped up
is the next hour, day 31 the 1st of the next month. Stepping the month or the
year clamps the day instead, so 31 MAR moved to February lands on the 28th.
The state clamps at both ends, and stepping up out of `OFF` always lands on
`ON` — even for a game whose schedule was armed when it was switched off.

The two halves are stored separately, both keyed by game id: the games that
are switched off in `localStorage` under `tarmac.roster.v1`, the unlock times
under `tarmac.unlocks.v1`. Unlock times are read against the machine's local
clock — there is nothing else to ask on a cabinet with no network. Ids that
are not in the registry are kept in both, so a game pulled for one event and
put back does not lose how it was left.

## Idle and attract

The cabinet is left mid-match constantly: a round ends, the players wander
off, and whoever arrives next finds someone else's finished game. So nothing
stays put.

- **No input for a minute** and the current screen goes back to the menu,
  with a `MENU IN 5 / PRESS ANY BUTTON` panel up for the last six seconds.
  Any input at all clears it — including a *release*, so a hand resting on a
  button is enough. The minute is the **idle timeout** on the options screen:
  `OFF`, or 30 seconds to 5 minutes (`IDLE_RETURN_STEPS` in
  `core/settings.ts`), read per frame so a change lands on the spot. `OFF`
  suits a tournament on a stage, where the only thing that should ever
  interrupt a long match is a player.
- **The menu itself never times out.** Instead, after 12 seconds
  (`IDLE_ATTRACT_SECONDS`) it starts browsing itself, one card every 5
  (`ATTRACT_STEP_SECONDS`), through the same virtual index a player drives —
  so the room sees the whole list instead of whatever was left selected. A
  game that timed out lands on a menu whose idle clock is already past the
  threshold, so the cycle picks up straight away. An open controls modal is
  closed when attract starts, since the card under it is about to move.

The attract numbers are fixed, in `core/config.ts` — including the six-second
warning, which is a property of the warning and not of the wait in front of
it. Turning the timeout `OFF` does not stop the menu attracting: attract has
no game to interrupt.

**One clock for the machine**, in `core/idle.ts`, deliberately not one per
scene: it is the cabinet that is idle, and the timer has to survive the
transition it causes. **One gate**, too — `defineScene` installs the bail-out
on every scene except the menu, the same way the menu is the only place an
unlock is checked. A game that had to remember the call would be a game that
one day forgets it and strands the cabinet in a finished match.

What counts as activity is decided in `core/input.ts`, which is the only place
that already knows what every player did this frame:

- a press or a release of any bound button, on either player, pad or keyboard;
- **any** key event, bound or not, because on the setup screens the key being
  pressed is often the one that is not bound to anything yet;
- any raw pad button or axis that binding capture sees move, for the same
  reason — those presses may resolve to nothing at all on a miscalibrated pad,
  and that is the screen you fix it on;
- a button being *held*, but only for its first 30 seconds
  (`STUCK_HOLD_SECONDS`). Holding is playing — a paddle pinned at the top of
  the court is someone playing badly — but a jammed switch, a coin resting on
  a button or a taped-over stick would otherwise keep the machine inside a
  game for the rest of the day. A real hand always releases, and the release
  clears the clock.

`idle` is on the F3 overlay, next to the pad count, which is the quickest way
to see whether something on the cabinet is reporting input nobody is giving
it.

## Offline and installing

The cabinet is expected to run with nothing plugged into it, so the build is a
PWA (`vite-plugin-pwa`, configured in `vite.config.ts`). Every byte the app
needs is precached on first load: there are no fonts, sprites or sounds
fetched at runtime, and settings and bindings live in `localStorage`. After
one visit over the network, the machine works forever without it.

```bash
npm run build && npm run preview   # the worker is only real in a build
```

The worker is off in `vite dev` on purpose — a stale precache is the last
thing you want while editing. `F3` shows `sw ok` once it is registered, `sw
off` if it never was (dev, or a plain `file://` open), and `sw upd` when a new
build is waiting.

`display: fullscreen` and `orientation: landscape` in the manifest, so an
installed copy takes the whole monitor. `scope` and `start_url` are relative,
resolving against the manifest's own URL under `base` — see **Deploying** for
what `base` is set to and what that costs.

**Updates land on the menu, never mid-game.** The usual auto-update worker
claims the page and reloads it the moment a new build appears, which on a
cabinet can end a rally in progress. So the worker is registered in *prompt*
mode and `core/pwa.ts` holds the new version back until `syncPwa()` is called
from menu entry — between two games, with nobody playing, where a reload is
indistinguishable from the menu redrawing. There is no actual prompt: nobody
at an arcade cabinet answers a dialog about service workers.

The update *check* rides on the same call rather than on a timer. The cabinet
returns to the menu constantly — a finished game, the idle bail-out — which is
a better cadence than any interval we would pick, and it means there is no
long-lived timer to own. It is throttled to once every 15 minutes so a busy
carousel is not a request per card, and it fails silently offline, which here
is the normal case.

Icons live in `public/icons/`, rasterised from `icon.svg` in the same palette
as everything else; the `favicon` in `index.html` is the same mark inlined so
the tab costs no request.

## Deploying

A push to `main` builds the app and publishes `dist/` to GitHub Pages
(`.github/workflows/deploy.yml`).

`base` in `vite.config.ts` is **`/tarmac-retro-games/`**, the path a project
page is served from, and it has to match the repository name: rename the repo,
move to a user page at the origin root, or serve the build from a kiosk shell
at another path, and every asset 404s until `base` is changed with it. The
alternative is `"./"`, which resolves against whatever document loads the
page and so works from any path; what it gives up is deep URLs under the base,
which is irrelevant here — the cabinet is one document with no routing, and
Pages answers such a URL with its own 404 rather than the app. Either works;
this one is explicit.

`base` applies to `vite dev` and `vite preview` too, which is why both serve
at `http://localhost:<port>/tarmac-retro-games/` and redirect `/` to it.

One-time setup, in **Settings → Pages → Build and deployment**: set **Source**
to **GitHub Actions**. Then push to `main`, or run the workflow by hand from
the Actions tab.

The typecheck is part of `npm run build`, so a type error fails the deploy
rather than shipping. Deployments are serialised and never cancelled mid-flight
— a partially replaced site would serve files from two builds at once, which is
the one thing the precache manifest cannot reconcile.

The hosted copy is the same PWA as the cabinet's: visit it once over the
network and it is installable and works offline from then on, with updates
applied on menu entry (see above). That makes Pages a reasonable way to load
a cabinet in the first place — open the page, install it, unplug the network.

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
    idle.ts            idle clock, the timeout back to the menu
    game.ts            GameDefinition — the contract a game implements
    debugHud.ts        F3 overlay: fps, object count, heap trend, live input
    buttons.ts         the logical button vocabulary games code against
    controls.ts        the per-game controls modal shown from the menu
    bindings.ts        per-controller button bindings + localStorage
    settings.ts        game scale, idle timeout + localStorage
    unlocks.ts         per-game release times + countdown strings
    roster.ts          which games are switched on, + the state ladder
    cheat.ts           hidden button-sequence matcher
  games/
    registry.ts        the menu's game list
    pong.ts
    snakeDuel.ts
    tetrisDuel.ts
    brawl.ts
    lastStand.ts
  scenes/
    menu.ts
    inputTest.ts       live raw button/axis readout
    bindingSetup.ts    rebinding screen
    options.ts         scale, idle timeout, and a row per game
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
| Tetris next-piece cell | 5 | 10 |
| Brawl round clock | 20 | 40 |
| Countdown text | 28 | 56 |

Steps are discrete because at this resolution a factor of 1.07 buys nothing
anyone can see, and Snake's board has to land on a whole number of cells.

Tetris is the case where the answer is *nothing on the field*: 10x20 at a
10-unit cell is the game — spawn columns, kicks and every stacking decision
are stated in those dimensions, and two wells plus their side panels is
exactly what 320 units holds. So the setting drives what is read rather than
played, the next-piece preview and the countdown, and its sample says
`WELL CELL 10` underneath at every step.

Tarmac Brawl lands the same way, for a different reason: a fighter's size *is*
their reach. A 96-unit body against a stage that never scrolls is the entire
spacing game — how many walking steps a kick is worth, how far a jump crosses,
how pinned the corner feels. Scaling the bodies would not make the match
chunkier, it would make it a shorter stage. So the setting takes the round
clock and the countdown, and leaves the fight alone.

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
   `register()` calls `defineScene(id, body)`. Its `controls` rows are
   required — they are the only place a player at the cabinet can read what
   the buttons do. List the game's own actions only; the modal adds the
   "hold Back to quit" line itself.
2. Add it to `GAMES` in `src/games/registry.ts`.

Nothing else changes — the menu builds itself from the registry, including the
optional animated `drawPreview` thumbnail, and the options screen picks up the
optional `drawScaleSample` the same way and gives the game a row of its own,
with its state and its unlock time.

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
- For anything numerous and uniform — grid cells, snake segments, a Tetris
  well — keep state in preallocated typed arrays and paint it in one
  `onDraw`, instead of one game object per cell (see `snakeDuel.ts`,
  `tetrisDuel.ts`).

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

A game switched **off** on the options screen is not on the carousel at all —
no card, no dot, no place in the wrap-around — and with every game off the
card area carries the `NO GAMES ENABLED` notice instead, with browsing and
A/Start inert behind it. The list is read once on menu entry, which is enough:
the options screen is the only thing that changes it and leaving options comes
back through here.

A game whose unlock time has not passed yet stays on the carousel as `???`:
the preview still runs under a veil with a padlock over it, and the card's
own lines carry `LOCKED`, the countdown and the release stamp. It keeps its
place in the list because the countdown is the point — a card nobody can see
advertises nothing. A/Start on it blinks the card red and puts
`LOCKED  UNLOCKS IN …` where the footer hints were, and **Y** is refused the
same way, since the controls modal names the game in its header and can launch
it. The menu is the only gate: the game's own scene is unreachable except
through here, so there is no second check to keep in sync.

**Y** opens the selected game's controls modal — one glyph row per action,
drawn from the `controls` in its `GameDefinition`, so a rebound button shows
up as the button that now drives it. A/Start plays straight from the modal,
B closes it; browsing is ignored while it is open, so the card underneath
cannot change out from under the list. A keyboard line appears only while no
pad is connected at all — as soon as there is one, the glyph rows are the
whole story.

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

Re-measured when Tetris Duel was added: 50 menu/game transitions left `obj` on
5 (peak 6) and `cln` on 0, with the post-GC heap lower at the end than at the
start.

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
