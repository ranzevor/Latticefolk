# Foreground simulation clock and input

TownGame integrates monotonic foreground time in steps of at most 50 ms, with
at most 2 seconds of simulation per animation callback. Longer foreground gaps
retain chronological time and input debt. Pending time is exposed in the existing
read-only world diagnostics. Sustained rendering slower than this work budget
can increase pending time and input latency.

First-person key edges and pointer-look events retain their timestamps and
headings. Movement keeps the existing 4.5 m/s walking and 7.2 m/s sprint speeds,
collision authority, terrain checks, NPC head clearance and movable-prop solver.
Streaming is checked after each player substep. The input-seconds counter records
actual attempted physical steps, including collision-blocked attempts.

## Boundaries

- Hidden documents and window focus loss clear pending time and input. Resume
  starts a new timeline and requires a fresh movement press.
- Menus, admin-panel changes, editable focus, pointer-lock changes and camera-mode
  changes cancel unconsumed player input. The visible, focused world keeps running.
- A key held through persistence loading starts contributing time only after
  readiness. A press released during loading contributes no movement.
- At most 256 input transitions are pending. Identical states are omitted and
  same-time transitions coalesce. The final slot holds a release boundary.
  Overflow retains accepted input and world-time debt, rejects excess new input,
  releases held controls and increments a cumulative diagnostic counter. A fresh
  press is needed after capacity becomes available.
- A callback performs at most 40 regular time steps plus 256 input-boundary steps.
  God-camera input retains its separate observer timeline. Existing wall-clock
  decision, network, autosave and respawn deadlines are unchanged.

## Validation controls

Waypoint and parcel routes issue finite keyboard pulses using elapsed browser
time. Pulse duration uses the remaining distance and unchanged movement speed.
Release delays count as actual input. Catch-up stays inside the original route
deadline, and waypoint direction-input budgets remain cumulative across pulses,
including collision-blocked attempts.

Waypoint and coarse-boundary checks require a fresh clock HUD publication after
the pulse keys are released and `pendingInputChanges === 0`. Native pulse release
boundaries must also be covered by `simulationConsumedThrough`; coarse-boundary
checks match the returned boundary to the observed trusted key releases and
require the corresponding materialization state. A HUD publication time or the
original event timestamp alone does not prove completion: late accepted input
can be retimed beyond that timestamp. Missing or invalid required clock, release
or consumed-boundary evidence cannot establish completion. Unrelated world-time
debt may remain positive. Each waypoint route and coarse-crossing leg keeps its
original deadline; waiting for release consumption does not renew it.

Parcel traversal requires both `pendingSeconds === 0` and
`pendingInputChanges === 0` before movement and after each pulse. Pulse completion
also requires a fresh HUD publication after the corresponding trusted keyup,
a matching returned release boundary and `simulationConsumedThrough` covering
that boundary. Its complete route retains the 90 s deadline.

Released-player-frame observations begin after key release and require a new
HUD publication, a post-request animation-frame timestamp, finite position/input
samples and both zero pending world time and `pendingInputChanges === 0` within
the default 20 s timeout. Movement keydown/keyup events discard earlier mutation
records and require a new HUD publication. Missing or malformed required clock
fields fail closed. Route failures retain input-duration and clock diagnostics.
Controlled route tests run the production clock and collision solver.

Wildlife resource selection, accepted proposals and completed actions share one
resource-compatibility predicate. Water and stone are not food targets; drinking
still accepts water. Completion rechecks targets that changed or disappeared.

## Verification

Run the deterministic suite with `node --import tsx --test tests/*.test.ts` and
TypeScript checks with `npm run typecheck`.

Clock and runtime coverage starts in `tests/simulation-clock.test.ts`,
`tests/simulation-frame-boundary.test.ts`,
`tests/simulation-consumed-boundary.test.ts` and
`tests/player-clock-runtime.test.ts`. These cover bounded foreground catch-up,
between-frame key edges, late-event ordering, cancellation, overflow recovery
and input debt independent of world-time debt. Runtime fixtures construct
TownGame and drive DOM input, PointerLockControls, animate and production
collision, with rendering and pre-boot consumers supplied as test doubles.

Route and release-consumption cases are in `tests/native-waypoint.test.ts`,
`tests/native-waypoint-release-frame.test.ts`, `tests/parcel-route-clock.test.ts`
and `tests/coarse-native-transition.test.ts`. Chromium/WebGL gameplay coverage
runs with `npm run test:e2e`.
