# Maintenance technical contracts and acceptance matrix

The [roadmap](roadmap.md) defines the persistent living-world direction. This document records current correctness, evidence and acceptance contracts without assigning an execution order. Completion is determined by the applicable source, tests, runtime state and inspected player-visible output described here.

## Evidence boundaries

Authoritative facts, conservation, persistence and deployment boundaries are correctness-critical. Scheduling behavior, visual quality, regression coverage and measured scalability each have their own acceptance conditions. Reproduced defects, source-confirmed risks, visual observations and untested paths must remain distinct. An untested path is not necessarily broken; a transactional write can still atomically overwrite the world with stale data; a green home-town browser smoke is not whole-world acceptance.

| Area | Current technical contract or gap | Acceptance matrix |
| --- | --- | --- |
| Player-visible quality | Character grounding, source-aligned collision and licensed presentation must agree with authoritative runtime state. | Current-source native browser input, inspected images and the applicable gameplay, persistence and free-play journeys are evaluated separately. |
| Conserved transfers | Transfer amounts are bounded by source stock and destination room; invalid, nonfinite, self or aliased transfers leave both endpoints unchanged. | Capacity limits, fractions, atomic rejection, receipts and seeded mixed transfers preserve totals within explicit floating-point tolerance. |
| Population flows | Local policy ticks cannot create or delete population without endpoints; policies influence conserved neighbor transfers. | Seeded policy cases preserve population across source and destination chunks. |
| Snapshot validation | Unknown snapshot payloads are validated before storage. | Malformed inputs leave the SQLite world unchanged, including revision and previously stored rows. |
| Persistence concurrency | Omission-preserving writes, monotonic revision/reset and stale-writer CAS apply across browser contexts and server restart. | Conflict latching, delayed writers, final beacons and real restart behavior retain acknowledged state. |
| Coarse request lifecycle | Chunk, region and world requests use one abortable fetch/body deadline and reject stale, out-of-batch, unexpected, duplicate or invalid replies. | Deferred-fetch and materialize/unload cases release pending state, preserve request-time baselines and permit a valid retry. |
| Applied flow history | Coarse flow history is bounded in memory, and wildlife migration still needs durable applied receipts with time and reason. | A durable deduplicated journal reconciles applied events with balances without double application. |
| Network deployment | Mutation and provider routes require an explicit authorization boundary whenever the service is exposed beyond its local mode. | HTTP and browser write cases cover local rejection and authorized deployment behavior without exposing provider credentials. |
| Decision service fairness | A bounded scan is not sufficient when stressed chunks can monopolize the bounded service set. | Adversarial coverage demonstrates bounded fair service while pressure changes still affect responsiveness. |
| Scenario coverage | Controlled home fixtures do not establish streaming/revisit, domestication/follow, production or the full restart journey. | Real-input materialize/unload/revisit, follow cleanup, production conservation and restart scenarios are evaluated independently. |
| Licensed presentation | Well, furniture, trees, buildings and other semantic targets require acceptable-license assets, calibrated bounds and no unrelated primitive substitute. | Loader/source checks are paired with actual scene inspection and representative current-source screenshots. |
| GPU resource lifetime | Owned resources are disposed once; shared templates survive teardown and re-entry. | Repeated real-browser materialize/unload loops measure renderer resource counts and fail on retained owned resources. |
| World scaling | Rendering may be bounded while discovered-world simulation, snapshots and aggregates still scale with total history. | Seeded tick, save, query and memory benchmarks quantify the cost before and after a change. |
| Documentation coherence | Current behavior, compatibility limits and remaining acceptance scope must agree across architecture and validation docs. | Contradictory future/current claims are removed together with the corresponding technical change. |

Rows are independent acceptance dimensions. A change that intersects several rows must preserve each applicable contract; coverage of one row does not establish another.

## Conservation and scheduling counterexamples

Debiting a requested food transfer of 10 from a source of 50 while capping a destination of 99 at 100 produces 40 and 100: total 149 becomes 140 while a receipt of 10 overstates the credit. Independently rounding source 1.0004 and destination 2.0004 during a transfer of 0.1 loses 0.0008. Nonfinite requests and self/aliased endpoints must leave balances unchanged. The capacity example exercises the executor/replay boundary even when the normal deficit planner would choose a smaller request; generated fractional balances also require conservation.

`CoarseWorldRuntime.runConservedFlows()` calls the conserved transfer executor. One actual amount is bounded by current available stock and destination room, both proposed balances are checked before either write, and receipts retain actual amount plus original provenance. Authoritative balances are no longer rounded independently. Population is not assigned an invented capacity. Nonfinite, invalid, self/aliased and unrepresentable transfers are no-ops. Numeric conservation assertions explicitly allow IEEE-754 tolerance; this is not an arbitrary-precision ledger.

`tests/flow-conservation.test.ts` covers capacity limits, fractional balances, invalid/self transfers, 4,000 seeded mixed transfers and raw-total checks. Population-policy conservation, wildlife execution/history and persistence writer conflicts use separate contracts and regressions.

A rotating 256-ID scan window over 512 initialized chunks does not guarantee fair decision service. Eight continuously stressed chunks in each window can monopolize service while the remaining scanned chunks stay unserved. Capped waiting priority cannot outrank a permanent larger pressure term; bounded scanning and bounded service are separate requirements.

## Coarse request lifecycle

Chunk, region and world requests bound fetch and JSON stalls, release pending state for recovery, validate request membership and generation context, reject stale/out-of-batch/unexpected/duplicate/invalid proposals, preserve request-time baseline correctness, and keep provider calls under the shared budget controller. Materialize→unload transitions must reject crossed-generation replies and allow retry recovery.

## Player-visible presentation and interaction boundaries

Player-visible acceptance separates authoritative grounding, world presentation, gameplay usability and performance/user journeys. Building scale, well/furniture presentation, tree occlusion, terrain seams, coarse proxies, HUD/i18n, persistence and free-play each retain their own acceptance conditions rather than inheriting a result from another area.

The building scale contract normalizes licensed visuals to the same semantic width/depth/height used for gameplay. Rotated physical bounds follow the visible footprint, and building construction does not create primitive wall/roof/window/door geometry while assets load. Well, furniture, tree occlusion, terrain seam and coarse proxy presentation require their own acceptance checks.

## Semantic furniture presentation

The furniture contract replaces the floating or primitive bench, public bed, food stall, maker/mill workstations, guard work point and farm plot with licensed CC0 source assets. Browser acceptance counts the exercised center-town semantic visual targets and rejects Box/Cylinder/Cone geometry under those objects after load/reload. The bakery oven uses its separate sourced-oven implementation and native crafting/persistence gate described in `semantic-prop-acceptance.md`; it is not part of the eight-target furniture count. Tree, terrain-seam and coarse-proxy presentation remain separate acceptance scopes.

## Visual and E2E requirements

Well visibility requires nonzero material opacity; nonempty geometry or a visible-looking bounding box is insufficient. Furniture appearance, tree-canopy occlusion and building-to-person proportions require actual scene inspection. Building/model bounds use a roughly 1.7 m character reference rather than a categorical scale judgment from perspective alone.

Building construction and coarse marker presentation have separate paths. The permanent rule forbids creating an extra visible door/model or new primitive fallback; removal/replacement uses only sourced, acceptable-license assets and notices. Image appearance alone does not prove an asset's provenance.

The real Chromium acceptance matrix includes home assets/ground, cart push, injected 503 save retry, browser reload, God View enter/exit with no discovery or player body, tree chop, persistence CAS/restart behavior and coarse materialize→unload stale-reply rejection/retry. A run that omits remote unload→revisit, owner-follow target cleanup or production conservation does not establish those separate journeys.

## Capability and verification boundaries

Richer NPC households, schedules, ownership/social history, economic logistics, true stacking/support and additional licensed movable archetypes, projectile mechanics, save export/backup/recovery, and broader world/region ecology remain roadmap capability work. More detailed collision/entrance alignment, frame-partition determinism and loaded/unloaded ecology equivalence require targeted tests before stronger conclusions. The large integration file `src/main.ts` is a maintenance risk but does not change the correctness acceptance boundary.

## Validation boundary

A change is evaluated against the exact source under review. Applicable checks reproduce the relevant condition, preserve authority/conservation/persistence boundaries, exercise real browser input when required, avoid the regular player save, and inspect player-visible artifacts when visibility is part of the contract. Partial coverage does not establish unrelated acceptance dimensions.

## Sourced oven and remaining primitive inventory

The oven contract replaces the previously undefined baker/oven visual with a provenance-pinned CC0 wood-fired baking oven. The source scene is filtered to the complete existing oven, not recreated from primitives or replaced by cookware. Current-source native browser artifacts must show home/generated visibility, collision reach, crafting conservation and save/reload. Stable home/generated identities, NPC work targets and recipes remain unchanged.

Construction-only primitive branches are removed for already sourced trees, crates, mine and explicit asset overrides. This is not scene-wide primitive elimination: generic dropped-item boxes, procedural wildlife models, ground/roads, diagnostic coarse/debug shapes and invisible/UI shapes remain distinct non-sourced or primitive paths. Streamed water surfaces and normal settlement/wilderness coarse markers already use sourced assets; they retain separate browser/image acceptance for visibility, scale, terrain alignment/seams, lifecycle and God View/materialization behavior rather than remaining in the primitive-replacement inventory. Formal semantic-model paths must retain interactable entities and their physical boundaries. Well preparation and native-input preconditions remain required for their respective scenarios. Character container Y is only a grounding foundation; actual feet/poses, tree occlusion, crop shadows, terrain and broader user journeys remain separate acceptance scopes.

## Environment presentation

Adult-scale sourced trees align their actual basal vertices and collision with semantic anchors, including the streamed override path. Current skin-deformed soles replace periodic whole-body bounds as the character visual support measurement. Unused NPC block construction and invisible player-avatar meshes are removed. Kenney soil/wheat retain pinned originals and derive dielectric materials without recoloring or replacing geometry; crop roots align with the soil top. See `environment-presentation.md` for numeric and real-browser contracts. Current-source native browser scenarios and separately inspected images are required; source tests or documentation alone do not establish player-visible results.

This inventory explicitly retains generic dropped-item boxes, procedural wildlife models, terrain/road representation and diagnostic coarse/debug shapes as distinct remaining paths. Sourced streamed water and normal coarse markers are implemented presentation paths, but they do not by themselves establish visibility, scale, terrain alignment/seams, lifecycle, complete coarse-distance presentation or broader user journeys. Sourced tree/standing-locomotion/crop corrections likewise do not establish personal-space, seated/sleeping poses or all shadows.

Grounded sole measurements do not establish contact shadows or player/head clearance: the default small sun shadow volume left nearby actors without ground-contact shadows, and the 0.32 m motion body allowed the player's view into wide source heads/hair. Bounded, texel-stable view-following shadows and separately calibrated symmetric player/NPC motion clearance address those conditions. Source geometry, directional collision, real-input dialogue/save/reload and observer-pan gates cover this scope. NPC/NPC full-body/pose work, remaining formal primitives, terrain/coarse presentation and broader journeys retain separate current-source browser and image acceptance.

A building's saved frontage is not its body anchor. Home building restore uses the layout-owned building contract rather than generic movable-object position restore, keeping model, collider and trigger transforms aligned. The twelve home body/frontage/collider/trigger records must remain equal through the native round trip; saved dialogue and NPC/player positions remain intact. This repair does not establish full exploration or the complete server-restart journey.

## Local validation

`npm run validate:local` retains a complete source snapshot before executing its checks and rejects a source set that changes during the run. Playwright resets only its dedicated E2E SQLite database; never point it at a player's regular save.
