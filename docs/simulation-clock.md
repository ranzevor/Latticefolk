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
time, then observe the rendered position after pending simulation time reaches
zero. Pulse duration uses the remaining distance and unchanged movement speed.
Release delays count as actual input. Catch-up time stays inside the original
route deadline; failures retain input-duration and pending-time diagnostics.
The controlled route tests run the production clock and collision solver.

Wildlife resource selection, accepted proposals and completed actions share one
resource-compatibility predicate. Water and stone are not food targets; drinking
still accepts water. Completion rechecks targets that changed or disappeared.

## Verification

The initial draft head `8a152303da32747d8db0c122b14b3d4f14d77b53` passed all
1,251 deterministic tests and the build in [run 38028059045](https://github.com/wangfumin1/Latticefolk/actions/runs/38028059045).
Its native-input browser case recorded a trusted 456.7 ms key hold, 456.7 ms of
attempted movement and 2.0552 m displacement at 4.5 m/s, with no remaining debt,
input overflow or page errors. The three sampled frames had intervals of 447 ms
and 238.3 ms. This small sample establishes input response in that run, not a
scene-wide performance result.

That run executed all 30 browser cases: group A passed 9/11 and group B passed
15/19. Four failures exposed frame-count-based navigation, one exposed an
incompatible food target, and one mixed a stale-response check with a subsequent
valid response. The revised controls preserve their original targets, deadlines,
input budgets and resource assertions.

Local validation of the revised candidate passes 1,273 deterministic cases,
TypeScript checks, the production build, strict E2E typechecking and discovery
of all 30 browser cases. The test command is
`node --import tsx --test tests/*.test.ts`.

The 39 original clock/runtime cases cover actual TownGame construction, DOM
input, PointerLockControls, animate and collision; 1 FPS versus 20 FPS; an 800 ms
between-frame press; 5-second foreground gaps; interruption and overflow recovery.
Rendering and pre-boot world consumers are controlled test doubles. Local browser
startup is blocked by socket permissions. The revised head still requires its
natural full Chromium/WebGL run and exact-head artifact review.
