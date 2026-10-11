# Playable input validation

## Why the post-merge cart gate needed repair

Main `0a05bb59e18140b27afce84ff31366b8ec47bcd6` failed CI #1372 / run `36521378702`: build-test passed and eight of nine Chromium/WebGL scenarios passed. The original scene scenario failed before its save-retry/God View/tool assertions because the cart remained at Z=4.7 after a fixed 650 ms forward-input pulse.

Artifact `11013522208` (SHA-256 `cc3560de666629ecddd8818ba2971f0fee5403832328e9589092b71786632e32`) contains the executed trace. Its runtime samples show the player moving from (0, 7) to (-4.64, 6.3896) while the cart remained at (0, 4.7). The failure screenshot points into the sky. This evidence does not demonstrate a cart solver failure: input was no longer aligned with the expected starting direction. A fixed wall-clock pulse also does not establish that the player reached and physically pushed the cart.

The direction-sensitive smoke now activates the existing Start button with native keyboard Enter via `startFirstPerson`. This invokes the normal click handler and pointer-lock request without an absolute Playwright mouse-positioning event immediately before lock acquisition. It does not assign camera rotation, teleport an entity, call a game action, disable collision, or replace the renderer. The furniture and visible-well scenarios retain native mouse Start clicks and relative look input through the existing PointerLockControls listener.

The cart step holds real movement input until the observed cart Z has decreased by more than 0.20 m, under a bounded 10 s deadline. It additionally rejects unexpected lateral player displacement. A blocked or broken cart still fails; no retry-to-green loop or weakened displacement assertion is introduced. The existing injected HTTP 503, dirty flag, bounded retry, SQLite result, reload, God View and tree-contact assertions remain mandatory. Successful runs attach `cart-push-and-save.json` with before/after runtime samples and the persisted cart position.

## Validation requirements

Use `npm run check` for the complete deterministic test/typecheck/build gate. Use `npx playwright test e2e/playable-smoke.spec.ts` for targeted real-browser input, persistence and transition coverage, followed by `npm run test:e2e` for every scenario. Install Chromium with `npx playwright install --with-deps chromium` when needed.

A passing targeted run is not the full suite. A syntax-only transpile is not a typecheck. A successful screenshot capture, model count or bounding box is not evidence that the asset is actually visible. Review the executed report, before/after state and representative images from the exact tested head. Preserve each failure's trace and distinguish camera/input setup, navigation obstacles, render timing and authoritative state defects before changing either tests or runtime.

Fixtures may seed a legal saved starting state before game boot to isolate a subsystem. They must not mutate the live camera/world to manufacture the tested result, and they are not unscripted free play. Native startup, normal interaction events, actual WebGL rendering and server-side persisted consequences remain required.

## Scope

This repair does not finish #69. The remaining bakery/oven visual, scene-wide primitive cleanup, environment occlusion, terrain/coarse presentation, broader user journeys and performance/free-play acceptance remain open. Historical green runs do not replace fresh-head or merge-main evidence.

The foreground time, short-press and pause/resume contract is documented in
[Simulation clock and input](simulation-clock.md), including the distinction
between controlled runtime replay and natural Chromium frame measurements.
