# Playable input validation

## Native startup and physical cart contact

Direction-sensitive movement requires the starting heading to remain aligned
with the intended push. An absolute mouse-positioning event immediately before
pointer lock can arrive after lock and become relative-look input. Elapsed key
hold time alone does not establish player/cart contact or cart displacement.

`startFirstPerson` activates the visible, enabled Start button with native
keyboard Enter and waits for the hidden overlay and locked game canvas. It uses
the existing click handler and pointer-lock request without an absolute mouse
move immediately before lock acquisition. Furniture and visible-well scenarios
use native mouse Start clicks and relative look input through PointerLockControls.

The cart step holds native ShiftLeft and W while `moveUntil` observes a cart Z
decrease greater than 0.20 m, using its 10 s polling timeout. The resulting player
position must stay within 0.10 m laterally and move more than 0.25 m overall;
the final cart Z must remain more than 0.08 m behind its starting value. Movement
and pushing use the production collision solver. The injected HTTP 503, dirty
flag, bounded save retry, SQLite result, reload, God View and tree-contact
assertions remain required. `cart-push-and-save.json` records before/after runtime
samples and the persisted cart position.

## Validation requirements

Use `npm run check` for the complete deterministic test/typecheck/build gate. Use `npx playwright test e2e/playable-smoke.spec.ts` for targeted real-browser input, persistence and transition coverage, followed by `npm run test:e2e` for every scenario. Install Chromium with `npx playwright install --with-deps chromium` when needed.

A passing targeted run is not the full suite. A syntax-only transpile is not a typecheck. A successful screenshot capture, model count or bounding box is not evidence that the asset is actually visible. Review the executed report, before/after state and representative images from the current tested source. Preserve each failure's trace and distinguish camera/input setup, navigation obstacles, render timing and authoritative state defects before changing either tests or runtime.

Fixtures may seed a legal saved starting state before game boot to isolate a subsystem. They must not mutate the live camera/world to manufacture the tested result, and they are not unscripted free play. Native startup, normal interaction events, actual WebGL rendering and server-side persisted consequences remain required.

## Scope

Bakery/oven visuals, scene-wide primitive cleanup, environment occlusion, terrain/coarse presentation, broader user journeys and performance/free-play remain separate product acceptance scopes. Acceptance uses evidence from the current tested source.

The foreground time, short-press and pause/resume contract is documented in
[Simulation clock and input](simulation-clock.md), including the distinction
between controlled runtime replay and natural Chromium frame measurements.
