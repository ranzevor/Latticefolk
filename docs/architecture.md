# Architecture

Latticefolk separates **simulation truth** from **decision suggestions**.

```text
Browser / Three.js
  ├─ world rendering and input
  ├─ NPC runtime state
  ├─ pathfinding and action execution
  └─ observer / first-person camera semantics
              │
              │ bounded snapshots + legal choices
              ▼
Express API
  ├─ /api/decision
  ├─ /api/dialogue
  └─ DialogueStore
              │
              ▼
DecisionProvider
  ├─ fallback (local deterministic baseline)
  └─ jev (optional TypeSafe System One adapter)
```


## Semantic prop visuals

A semantic WorldObject may exist before its visual asset is available, but a player-visible fallback mesh is not authoritative presentation. Furniture and settlement props that have approved visual mappings create an empty semantic group, register deterministic interaction/physics state, and then resolve a licensed asset into that group. If the asset fails, the object stays visually absent and diagnostics report the failure instead of substituting a Box or Cylinder mesh.

Solid licensed furniture re-registers its static AABB from the resolved world-space visual bounds. Farm plots remain non-blocking semantic interaction areas and visually compose only sourced Kenney soil/crop models. Model identity is selected from semantic kind/tags: maker/mill workstations use a workbench, guard work points use a weapon stand and bakery/oven workstations map to the sourced cast-iron baking-oven asset. Resolved oven bounds register a dedicated static collider and interaction trigger; oven-specific exterior stance, recipe and inventory conservation, stable semantic identity and persisted state remain authoritative outside the visual mapping.

## Core invariant

A decision provider is not authoritative over the world. It cannot teleport an NPC, invent inventory, bypass collisions, or directly mutate numeric state. It selects high-level intent from legal candidates; the simulation validates and executes the result.

This boundary makes remote decision models replaceable and allows the game to continue when a provider is unavailable.


## Licensed visual asset boundary

Player-visible scene models that have a sourced third-party asset binding never expose primitive geometry as a loading or error fallback. Registering a licensed visual target immediately clears any construction-time placeholder from its Three.js group; the semantic entity, collision/trigger authority, and persistence state continue to exist while the asset loads. On success the licensed model is attached to that same group. On failure the visual stays absent and the failed asset key is surfaced to runtime/E2E observability rather than substituting a Box/Cylinder/Cone/Plane mesh.

The Chromium playable gate requires every registered licensed visual target in the exercised home scene to resolve with zero asset-load failures. This policy currently covers asset-backed town buildings, NPC characters, trees, the well, crate/barrel/mine props, and the licensed movable cart. Legacy semantic objects that still lack a suitable licensed asset remain separate visual debt and must be replaced with sourced assets when that area is touched; this policy does not legitimize their primitive visuals.

## NPC decision cycle

1. Build an NPC-centric world snapshot.
2. Remove entities the NPC cannot perceive. In god mode, the player does not exist in the NPC snapshot.
3. Compute legal actions from current game state.
4. Ask the active `DecisionProvider` for bounded choices.
5. Reject stale responses using the perception epoch when camera/world semantics changed during an in-flight request.
6. Execute movement and action consequences through deterministic game systems.
7. Record short-term memory and schedule the next decision.

## Dialogue pipeline

The dialogue store can contain complete authored lines or `opener/body/closer` fragments. Local retrieval first narrows a large library by tags, role, mood, and intent. The decision provider sees only that bounded candidate set and selects IDs. It does not need access to the entire corpus.


## Hierarchical world simulation

Latticefolk now has two live simulation levels:

- **Fine/local layer:** the center 3×3 chunks are materialized as NPCs, objects, navigation, dialogue, and rendering.
- **Coarse/distant layer:** surrounding chunks keep aggregate population, food, wood, water, ecology, danger, prosperity, settlement level, and regional policy without instantiating every entity.

Distant chunks are not AI-free placeholders. The active decision provider receives bounded chunk batches through `/api/world/chunks/decide`. A Jev provider decomposes each chunk into parallel strategy, migration, and ecology choices in one request. The deterministic world simulation then converts those policies into bounded numeric consequences.

Chunk decision scheduling is simulation-driven rather than a fixed provider polling loop. After each successful bounded decision, the runtime captures a transient baseline of population, resources, ecology, danger, and prosperity. Deterministic local scheduling combines scarcity/instability pressure, decision staleness, and normalized state surprise to rank non-materialized chunks. New or restored chunks are refreshed promptly, large state changes shorten the next provider wake-up, calm chunks back off to a longer cadence, and provider failures use an explicit retry floor. These scheduling signals decide only when and which bounded policy questions are asked; they never mutate authoritative world state and remain subject to the shared provider budget controller.

Coarse chunk, region, and world policy requests also have a bounded client lifecycle. One abortable deadline covers both network fetch and response-body decoding, so a stalled provider cannot leave the scheduler permanently pending. Every request snapshots the current coarse decision generation; restore or coarse↔fine materialization ownership changes advance that generation and invalidate any reply that crossed the transition. Chunk replies must additionally belong to that exact request batch, refer to the same still-coarse runtime object, contain one unique row per chunk, and pass the legal strategy/migration/ecology schema. Region/world rows receive equivalent enum/shape validation. Rejected, duplicate, unexpected, timed-out, late, or generation-stale replies cannot mutate policy or decision baselines. Accepted chunk baselines come from request-time physical state rather than response time, so deterministic simulation changes that occurred while the provider was in flight remain visible to surprise scheduling.

This preserves the same authority boundary used for NPCs: a model selects policy; simulation code owns state mutation.

Round-trip LOD keeps one authoritative representation per chunk: first-person entry materializes aggregate state into concrete inhabitants, resources and buildings, while exit collapses those entities back into aggregate state without losing persistent consequences.


### Coarse ↔ fine materialization (implemented first pass)

The first round-trip LOD path is live.

- The fixed center remains the always-fine demo town.
- Distant chunks continue as aggregate state until the **first-person player** enters one.
- Entering a distant chunk deterministically materializes a representative subset of residents, settlement buildings, interactive work/trade/water sites, and biome resources from that coarse chunk.
- While materialized, that chunk is removed from coarse evolution and regional-policy ticks to avoid double simulation.
- Leaving the chunk collapses fine entities back into the coarse representation.
- Resource depletion, representative wealth changes, and ecological depletion are summarized back into coarse indices.
- Detailed fine NPC/object state is cached in memory, so re-entering the same chunk during the session restores identities, inventories, relationships, storage, and resource depletion.
- God View never causes materialization; it remains an out-of-world observer.

Detailed fine-chunk history is persisted through the server-side SQLite snapshot described below. The in-memory cache provides session-local identity continuity, but it is not the durability boundary.


## Durable world persistence

World state is now durable across browser/server restarts through a server-side SQLite database at `data/latticefolk.sqlite`.

The persistence boundary mirrors the simulation hierarchy:

- `world_meta`: day, simulation clock, weather, player position, and player inventory;
- `coarse_chunks`: one authoritative aggregate record per distant chunk;
- `fine_chunks`: detailed NPC/object state for chunks that have been visited/materialized;
- `home_state`: detailed state for the always-fine center town.

SQLite runs in WAL mode. Saves are transactional, so coarse/fine/home tables move to the same snapshot together. The browser performs a periodic save and attempts a final `sendBeacon` save during page unload.

Persistence does **not** make the browser authoritative. The browser submits a validated snapshot to the server; the server owns the durable database. The current schema is snapshot version 1 and is intentionally simple while simulation data structures are still changing rapidly.

See [Persistence](persistence.md).


## Conserved cross-chunk flows

Coarse chunks now exchange population and resources through explicit transactions rather than independent counter edits.

The flow layer plans bounded neighbor-to-neighbor transfers for:

- population migration;
- food trade;
- wood trade;
- water trade;
- ecological/biological spread.

Each flow records a source chunk, destination chunk, amount, simulation time, type, and reason. The deterministic executor subtracts from the source and adds the same amount to the destination. Unit tests assert conservation across transfers.

Provider-selected chunk policies influence these flows indirectly: `release/evacuate` creates migration pressure, `attract` creates destination pull, and `trade_route` enables stronger resource exchange. Jev still does not write numeric balances itself.

Materialized chunks are excluded from coarse-flow planning while fine simulation is active, preventing duplicate accounting across LOD layers.


## Region and World decision hierarchy

Latticefolk now runs four decision scales:

```text
World policy        slowest cadence
  ↓
Region policy
  ↓
Chunk policy
  ↓
NPC intent          fastest cadence
```

Region aggregation summarizes neighboring chunks into population, settlements, food, wood, water, ecology, danger, and prosperity. The provider chooses only bounded regional policies: coordination priority, movement posture, and ecology posture.

World aggregation summarizes all known regions and selects a long-horizon priority, connectivity posture, and growth posture. Region and World decisions never directly write population or resources. Deterministic simulation interprets them as bounded modifiers on settlement growth, conserved flows, ecology recovery, and danger reduction.

Region/World Jev calls share the same input-token and USD budget as other call classes. Their configured class weights do not reduce the raw token estimate reserved for a request; weights above one add conservative admission headroom. Lower call frequency and bounded payloads reduce paid input usage.


## Dynamic coarse-world streaming

The coarse world is no longer bounded to the original 9×9 chunk square.

- First-person travel owns world discovery. Crossing chunk boundaries shifts a fixed active window around the player's chunk.
- New coarse chunks are generated deterministically from world seed and absolute chunk coordinates.
- Chunks leaving the active window unload only their coarse visuals; their authoritative state remains discovered and persists to SQLite.
- Returning to explored space restores existing history instead of regenerating it.
- The always-fine center-town 3×3 footprint stays reserved.
- God View never expands discovery or materialization.
- Conserved-flow planning now scans coordinate neighbors instead of all chunk pairs, keeping it approximately O(n) in discovered chunks.
- A persistent coarse-chunk coordinate index is maintained as chunks are discovered or restored. Deterministic conserved-flow and wildlife-migration planners reuse that index for neighbor lookup instead of copying the full discovered set and rebuilding duplicate coordinate maps every flow tick; conservation, materialization exclusion, and authoritative chunk state remain unchanged.

The active render window and the discovered persistent world are separate concepts, so travel has no fixed map edge while scene complexity stays bounded.


## Semantic procedural settlements

Fine materialization now generates settlement content from coarse state instead of using one generic layout.

A chunk chooses a deterministic archetype from biome, settlement level, strategy, danger, resources, and prosperity: `farmstead`, `market_hamlet`, `timber_camp`, `quarry_outpost`, `wetland_hamlet`, `refuge`, or `wilderness`.

The archetype drives:

- road layout;
- functional building mix and placement;
- water, farm, market, workshop, guard, storage, cart, mine, and tool sites;
- representative resident roles and work targets;
- biome-specific resource distribution.

Generated nature avoids building footprints and road corridors. Generated roads are themselves semantic `WorldObject` entities rather than visual-only meshes. All generated functional objects expose explicit capabilities used by both players and NPC decision logic.


## Deterministic production chains

Production is now a shared rules subsystem in `src/world/production.ts`, used by both NPC and player interactions.

Current chains include:

- grain → flour → bread;
- wood → plank → tool.

Recipes define workstation tags, preferred roles, exact inputs, and exact outputs. The decision model may choose the high-level `craft` action, but it cannot bypass missing inputs or invent outputs. Workstations generated by settlement archetypes expose matching semantic tags such as `mill`, `baker/oven`, `sawmill`, and `maker/workshop`.

This establishes the pattern for future production graphs: decision intent remains probabilistic, while recipe execution and inventory conservation remain deterministic.


## Coarse/fine wildlife ecology

Wildlife now participates in the same coarse/fine world hierarchy as people and resources.

The current species set is `rabbit`, `deer`, `boar`, `goat`, `fox`, `wolf`, `badger`, `lynx`, `bison`, `raccoon`, `sheep`, and `warg`. Every discovered coarse chunk keeps species populations with count, carrying capacity, and population health. Carrying capacity is derived from the species profile's biome/resource affinity plus ecology, water, danger, and settlement pressure. Coarse simulation applies bounded population growth/loss, profile-defined plant consumption and predation, disease/competition pressure, and explicit conserved neighbor-to-neighbor wildlife migration.

When a chunk materializes, a representative subset of its populations becomes persistent fine entities with:

- species, sex, age, health, hunger, thirst, and energy;
- inherited speed, size, fertility, and wariness traits;
- generation and birth-day metadata;
- local movement, grazing/foraging, drinking, resting, fleeing, hunting, and mate-seeking behavior.

Wildlife decisions are batched (up to six animals per provider request). Jev receives only bounded feasible actions and supplied resource/animal candidates; deterministic game code owns need changes, damage, death, resource consumption, reproduction, inheritance, mutation, and population accounting. Wildlife calls use the shared budget with a configurable class weight. Admission reserves at least the raw input-token estimate, so a low weight cannot discount paid input cost.

Fine reproduction creates persistent descendants by averaging parental traits plus bounded deterministic mutation. On chunk collapse, fine births/deaths are scaled back into the coarse population, while individual animals remain in the fine-chunk SQLite cache for future revisits.

SQLite `fine_chunks` now stores `wildlife_json`; startup performs a backward-compatible schema migration when an older database lacks the column. Procedural low-poly quadrupeds are used as a visual fallback until dedicated animal assets are integrated.


## Plant biomass, trophic flow, disease, and lifecycle

The ecology layer no longer treats `ecology` and `food` as the only environmental signals.

Each coarse chunk can persist four plant-biomass pools: grass, shrub, fruit, and cultivated crop. Regrowth depends on biome, water, weather, season, ecology policy, and settlement cultivation. Wildlife carrying capacity is recalculated from species-specific biome affinity plus plant food availability, water, danger, and settlement pressure.

The coarse trophic model tracks primary production, herbivory, predation, and mortality return. Plant-consumption weights and predation rates come from the same species profiles used by fine behavior. Herbivores deplete different biomass mixes, badger can consume plant biomass and rabbit prey as a true omnivore, and fox/wolf predation consumes actual prey population rather than creating/removing abstract food independently. Disease load responds to crowding, wet habitat, weather, migration, and recovery pressure.

Fine wildlife now includes senescence, local disease exposure/recovery, gestation, birth cooldown, litter size, parental IDs, inherited traits with bounded mutation, and explicit multi-generation offspring. Natural water sites and renewable fine resource nodes connect the fine simulation back to the same habitat constraints.

## Durable lineage and evolution observability

Wildlife ancestry is no longer inferred only from currently materialized animals. Every observed fine individual receives a durable lineage record keyed by entity ID. Records retain parents, generation, birth/death coordinates in simulation time, birth/death chunks, traits at birth/death, founder-versus-reproduction origin, terminal death cause, and lifetime offspring count. Death removes the fine entity but does not remove its ancestry record; later sparse snapshots also never prune archived ancestors.

Evolution statistics are deterministic derived data in `src/world/evolution.ts`. They aggregate living and historical individuals by species and generation, producing generation mean/max, reproductive birth count, death count, lifespan, offspring distribution, reproductive-success rate, trait mean/variance, trait slope per generation, mortality causes, and generation cohorts. `GET /api/world/evolution` exposes the same derived statistics server-side, while God View renders them as observer-only information.

This layer deliberately does not call Jev or any other Decision Provider. Providers can alter bounded behavior such as mate seeking, hunting, fleeing, or migration; the simulation owns conception, birth, inheritance, mutation, death classification, lineage accounting, and all statistical conclusions.

## Biome-linked selection-pressure observability

Each durable lineage can now carry habitat snapshots from origin and death: biome, ecology, food, water, danger, settlement level, and aggregate plant biomass. Reproduced offspring capture their true birth habitat; founders upgraded from older worlds use their first observed habitat and remain marked as founders.

`src/world/evolution.ts` groups lineages by species and origin biome, compares the trait mean of individuals that reproduced with the whole observed cohort, normalizes that differential by cohort standard deviation, and measures whether the direction repeats across generations. A signal is only labeled `persistent` when the sample has at least six individuals, at least two breeders, at least two observed generations, at least two generations with a non-zero breeder-vs-cohort differential, a normalized differential of at least 0.20σ in magnitude, at least 67% same-direction consistency across those comparable generations, and the realized trait trend across generations points in the same direction. Otherwise it is `weak` or `insufficient`.

These labels are evidence summaries, not causal declarations. Migration, correlated traits, demographic structure, and unobserved lifetime exposure can all confound them. God View exposes sample size, generation count, normalized differential, consistency, and habitat averages so the observer can inspect the evidence instead of receiving an opaque evolutionary verdict. The Decision Provider is not involved in this calculation.

## Observed lifetime habitat exposure

Birth/death habitat snapshots are now complemented by an explicitly observation-bounded lifetime exposure record. Fine wildlife accumulates simulation days spent under the currently observed chunk conditions, including time-weighted ecology, food, water, danger, settlement pressure and plant biomass, plus per-biome/per-chunk duration and observed chunk-transition count.

The simulation flushes the current interval when an animal dies or its chunk collapses. It does not infer named-animal movement during coarse simulation. When that individual is materialized again, observation resumes from the new fine-simulation time. This matters because coarse wildlife migration represents conserved aggregate population flow, not identity-preserving movement of a particular archived lineage.

Evolution statistics therefore expose two complementary biome views: **origin biome**, based on birth/first-observed habitat provenance, and **lifetime dominant biome**, based only on accumulated fine-observation duration. Lifetime habitat averages are weighted by observed exposure time. Both use the same sample-aware selection-evidence gates, while God View shows observed days so sparse exposure cannot masquerade as complete life history.

## Identity-preserving fine wildlife migration

Fine wildlife can now choose a bounded `migrate` intent. The provider sees only cardinally adjacent discovered chunks with species-specific coarse population/carrying-capacity state and environmental indices. Destinations at or above carrying capacity are removed from the legal candidate set. Jev or fallback may select `migrate` and one supplied chunk ID, but cannot choose coordinates, population amount, or mutate either chunk.

The deterministic executor re-validates adjacency, source/destination species populations, destination free carrying capacity, and the current fine identity. It computes the coarse population represented by that named individual, transfers exactly the accepted amount from source to destination, updates weighted health/disease aggregates, records lineage migration provenance, applies the destination entry point and energy cost, and preserves entity ID, parents, generation, traits, pregnancy state, and habitat history.

A migrant into an unmaterialized chunk enters a separate `wildlife_transfers` queue rather than `fine_chunks`. This is important: a transit identity is not a complete visited-chunk snapshot. When the destination later materializes, one procedural representative is replaced by the named migrant where possible. Migrated identities retain a fixed `representedPopulation` weight, so death and onward migration fold back using the same coarse quantity; ordinary fine representatives continue to use the existing bounded representative scale.

Fine-born individuals are not allowed to migrate until they have been folded into a chunk baseline and later rematerialized. This prevents a birth that has not yet entered coarse accounting from being transferred as if its represented population already existed. God View remains observer-only: wildlife flee logic no longer falls back to the player/camera position when no real predator target exists.

## Deterministic wildlife niche competition

Coarse wildlife now models explicit inter-species competition instead of relying only on independent plant consumption. Each species has a fixed simulation-owned resource-use profile across grass, shrub, fruit, crop, prey, and space. Pairwise niche overlap is derived deterministically from those profiles; current competitor density then produces species-specific competition pressure.

Competition never comes from the Decision Provider. The simulation computes a species' fundamental carrying capacity from biome affinity, ecology, forage, water, danger, and settlement pressure, then applies a bounded competition penalty of at most 32%. Density-dependent growth, health and migration therefore respond to the effective capacity while remaining numerically bounded. The strongest current pair and mean pressure are exposed through coarse-world status and God View.

Competition also enters evolution observability. Fine wildlife habitat snapshots include the species-specific coarse competition pressure at the time of observation, and lifetime habitat exposure keeps its time-weighted mean. Legacy lineage records without this field remain valid and are interpreted as zero observed competition for that historical snapshot rather than retroactively inventing data.

## Seasonal wildlife migration drivers

Seasonal movement is deterministic and layered on top of the existing migration/conservation system. Each wildlife species has a simulation-owned seasonal biome-affinity profile for spring, summer, autumn and winter. The current chunk state combines that seasonal affinity with ecology, species-relevant forage, water and danger into a 0–100 seasonal habitat suitability score.

Coarse migration planning compares neighboring chunks using density, disease pressure and seasonal suitability. A normal migration still requires the aggregate pressure threshold, but a destination that is at least eight suitability points better can create a low-amplitude seasonal migration driver on its own. The transfer remains source-to-destination conserved and is clipped by destination carrying-capacity room before execution. Seasonal preference therefore changes movement direction and pressure; it never creates or deletes population.

Fine wildlife receives current and neighboring seasonal suitability as part of the bounded migration candidate snapshot. Fallback and Jev can use that value to select `migrate` and a supplied adjacent chunk, but the deterministic executor still revalidates adjacency, carrying capacity, represented population, entry point and transit persistence. Seasonal suitability is also stored in new lineage habitat observations and time-weighted lifetime exposure, while legacy records remain valid without fabricated historical season data.

## Wildlife disease transmission pressure

Disease is now modeled as an explicit deterministic pressure system rather than only a scalar crowding increment. Each coarse chunk derives four components: **environmental pressure** from biome/weather/water/ecological stress, **local-contact pressure** from same-species disease load and density, **cross-species pressure** from bounded species-to-species contact coefficients and source density, and **migration-import pressure** carried by conserved wildlife flows. These components are combined into species-specific 0–100 transmission pressure and a strongest currently observed cross-species transmission pair.

The simulation remains authoritative. Coarse `diseaseLoad` moves toward the computed species pressure with bounded recovery; imported pressure decays over time. Wildlife migration transports both population and disease information without creating animals or infections out of thin air: destination disease load is population-weighted and an explicit imported-pressure term records the transient arrival signal.

Fine wildlife uses the same fixed contact coefficients but computes exposure from actual nearby animals, distance/proximity, coarse background pressure and environmental context. This permits deer→rabbit, rabbit→fox and other bounded cross-species pathways while preserving identity-level health state. No Decision Provider writes disease load, transmission coefficients, mortality or recovery.

Lineage habitat snapshots and lifetime exposure can now include observed species-specific disease pressure. This allows later fitness-by-habitat analysis to compare trait/reproductive outcomes under sustained disease pressure rather than inferring disease only from cause-of-death counts.

## Fitness-by-habitat evidence

The evolution layer now derives explicit outcome evidence from observation-bounded lifetime exposure. For each species it evaluates four currently measured dimensions: **niche competition pressure**, **seasonal habitat suitability**, **disease transmission pressure**, and **predator pressure**. Only lineage records with actual fine-simulation exposure for a dimension enter that dimension's sample.

For each exposure dimension, the deterministic analysis reports total exposure sample size, reproduction-eligible sample size, dead/lifespan sample size, mean observed exposure duration, mean exposure, breeder versus non-breeder exposure means, Pearson association with binary reproduction, offspring count, and observed lifespan among dead individuals. Living juveniles are right-censored from reproduction/offspring outcomes until they reach the shared species adult-age threshold; animals that die before adulthood remain completed non-reproductive outcomes. It also partitions the 0–100 exposure range into low (<33), medium (33–66), and high (≥67) cohorts and reports total and eligible population, living/dead counts, breeder rate, offspring mean, lifespan mean, trait mean, breeder-trait mean, and breeder-vs-cohort trait differential inside each band.

Correlations are reported as unavailable rather than zero when there are fewer than three eligible observations or when either variable has no variance. These statistics deliberately describe association rather than causation. Lifespan association is calculated only among dead individuals and can be censored/selection-biased; reproductive associations can be confounded by generation, migration, correlated habitat dimensions, and incomplete observation coverage. God View shows total/eligible/dead sample sizes, observed days, correlations, and cohort breeder rates rather than collapsing them into a single opaque adaptation score. No Decision Provider participates in the calculation.

## Profile-driven wildlife species semantics

Wildlife species semantics are centralized in `WildlifeSpeciesProfile` instead of being duplicated independently by coarse ecology, fine materialization, fallback decisions and rendering. The current set is `rabbit`, `deer`, `boar`, `goat`, `fox`, `wolf`, `badger`, `lynx`, `bison`, `raccoon`, `sheep`, and `warg`. Each profile owns trophic role, biome and seasonal affinity, niche axes, plant forage/consumption weights, base carrying capacity, growth/herbivory/predation rates, feeding action/resource tags, fine trait baselines, life-history thresholds, predator/prey preference-damage-hunger consequences, and constrained procedural morphology features.

Badger is the first explicit mixed-trophic validation case: it has non-zero plant consumption and a legal rabbit prey edge, so coarse trophic flow can record both herbivory and predation and fine behavior can choose `forage` when prey is absent or `hunt` when a supplied rabbit target is legal. Wolf can also predate badger. This verifies that omnivory is represented by simulation-owned semantics rather than a special Decision Provider prompt. Procedural badger visuals use the same profile to create a lower elongated body, tail and dorsal/face stripe; no new third-party asset is required.

Old persisted chunks may contain only earlier species populations or per-species pressure maps. Population initialization adds newly configured species deterministically, while historical pressure maps are typed as sparse/partial evidence: absence of a newly introduced species key remains unknown rather than being retroactively rewritten as zero. Current derived ecology recomputes complete maps from the configured species set when simulation runs.

## Heritable wildlife phenotype

Fine wildlife now carries an optional, save-compatible `WildlifePhenotype`. The runtime normalizes missing legacy state deterministically from entity ID. Morphology genes are bounded multipliers for body length/height, leg length, head scale and tail scale relative to the species profile; behavior genes are bounded forage drive, migration drive, risk tolerance and recovery drive. Species identity still defines the legal phenotype envelope and trophic/life-history rules, so mutation cannot turn a rabbit into a wolf or bypass the species graph.

Reproduction computes each offspring gene from the parental midpoint plus deterministic bounded mutation. The simulation owns this calculation. Procedural geometry consumes morphology phenotype directly, while fallback wildlife decisions use behavior phenotype only to adjust bounded thresholds such as predator flee distance, hunger-driven feeding, migration gain and recovery/rest. Jev receives the same phenotype as read-only context inside the existing wildlife budgeted request and can only select a legal supplied intent/target; it cannot write genes, physiology or outcomes.

Lineage records archive phenotype-at-birth/death plus provenance. New offspring use `birth`; new deterministic fine founders use `founder_seed`; a living animal loaded from a pre-phenotype save uses `legacy_upgrade`. Descriptive phenotype means/variance can include all known samples, but generation trends and breeder differentials exclude `legacy_upgrade`, so save migration cannot masquerade as historical selection evidence. God View and `/api/world/evolution` expose total/comparable provenance counts alongside morphology/behavior means, generation slopes and breeder differentials.

`wildlifeFunctionalPhenotype` is a pure deterministic mapping from inherited phenotype to narrow simulation multipliers. Leg length can improve movement speed but also raises locomotion cost; larger body dimensions increase maintenance and reduce speed; head scale plus forage drive can slightly improve hunger relief from the same consumed resource; recovery drive improves energy restored by a rest action; body/risk geometry can modestly alter high-intensity flee/hunt/migrate cost. Every multiplier is clamped close to 1.0 so phenotype creates trade-offs rather than arbitrary stat inflation. The Decision Provider never supplies these multipliers.

Fine simulation applies those multipliers to basal hunger/thirst/energy drain, pathing speed and movement energy, deterministic food relief, rest recovery and action energy costs. Resource removal, damage, health, inventory and population accounting remain simulation-owned. Evolution observability then groups comparable phenotype records by dominant observed lifetime biome and reports sample/eligibility/death coverage, breeder phenotype differential, and per-gene correlations with breeder outcome, offspring count and completed lifespan. Living juveniles remain right-censored and `legacy_upgrade` records are excluded from phenotype-by-environment evidence.

## Constrained organism-family genome

A separate `WildlifeOrganismGenome` generalizes individual variation beyond the first morphology/behavior phenotype without replacing species semantics. Every wildlife species maps to one simulation-owned family template: lagomorph, cervid, suiform, caprine, canid, mustelid, felid, bovid or procyonid. The template bounds three gene groups: material palette offsets, plant-niche preference multipliers, and locomotion stride/endurance. Founder values are deterministic by entity identity; offspring values come from parental midpoint plus bounded deterministic mutation.

The family layer is deliberately subordinate to `WildlifeSpeciesProfile`. Species profiles still define trophic role, legal prey edges, legal plant axes, life history, coarse carrying capacity and coarse ecological flow. Genome normalization always forces the correct family and clamps values to that template. Plant-niche genes only redistribute weights across axes where the species already has non-zero plant use; a wolf therefore keeps zero grass/shrub/fruit/crop use regardless of its genome. Fine plant consumption is renormalized to the species baseline total, so individual preference does not manufacture extra resource demand.

Fine locomotion combines phenotype physiology with genome stride/endurance. More stride can add a small speed benefit while increasing energy cost; more endurance lowers movement cost with a small speed trade-off. Both multipliers are tightly clamped. Material genes apply HSL offsets to the existing procedural body/accent palette rather than introducing arbitrary materials or meshes. These functions are deterministic and are never supplied by a Decision Provider.

The local fallback may rank already-legal forage candidates using the genome's niche preference. Jev receives the same genome only as read-only state inside the normal budgeted wildlife request. Neither path can change family, genes, plant legality, resource amounts, locomotion multipliers or outcomes. God View exposes the living genome and per-species lineage summaries; `/api/world/evolution` derives family, provenance coverage, means, variance, generation trends and breeder differentials from durable lineage. As with phenotype evidence, `legacy_upgrade` genomes are excluded from historical trend/differential calculations.

The Decision Provider never defines trophic relationships, species parameters, morphology, or numerical outcomes. Fallback and Jev only choose among legal `hunt`, `flee`, `migrate`, `seek_mate`, and other bounded actions/targets produced from simulation-owned semantics. A goat can flee a wolf because the shared graph says a wolf can predate goats; a wolf can hunt a goat because the same graph supplies that prey relation. This keeps coarse and fine LOD behavior aligned and prevents provider-specific food-web drift.

Species additions reuse existing persistence: coarse populations remain embedded in chunk JSON, fine individuals remain ordinary `WildlifeState` records, ancestry remains in `wildlife_lineage`, and transit identities remain in `wildlife_transfers`. No new authority path or species-specific persistence table is introduced.

## Reusable organism archetype composition

`wildlifeArchetypes.ts` now separates seven reusable, simulation-owned modules: habitat affinity/seasonality, ecology and trophic niche, procedural body plus organism-family ownership, movement mode, semantic wildlife action capabilities, organism form, and life history. `composeWildlifeSpeciesProfile` copies those modules plus a species-specific legal prey map into the same `WildlifeSpeciesProfile` contract already consumed everywhere else. The profile is now the single source for organism family, movement semantics and legal base capabilities; `organismFamilies.ts` no longer keeps a duplicate species→family table.

Lynx validates the predator path, bison validates a large herbivore path, and raccoon validates a mixed omnivore path. Lynx composes temperate forest/hills + medium ambush predator + medium felid + ambush movement; bison composes open plains + large grazer + large bovid + heavy-grazer movement; raccoon composes forest/wetland edge + opportunistic omnivore + masked small forager + dexterous-forager movement. Because coarse ecology, materialization, disease, competition, predator pressure, migration, lifecycle, lineage, evolution and decision candidate construction iterate the shared species registry, all three enter those systems without species-specific simulation branches. Procedural rendering uses reusable `ear_tufts`, `face_mask` and `ringed_tail` features rather than species-only external assets.

Movement and capability modules are functional configuration, not labels. Fine locomotion multiplies the inherited phenotype/genome trade-offs by the profile's bounded movement speed/energy/fast-action factors. Movement profiles also own gait, acceleration/deceleration rate, yaw turn rate and waypoint-arrival radius. `wildlifeMovementController.ts` applies those semantics as a pure deterministic step, while `TownGame` applies the resulting displacement only when the next position is not blocked. `wildlifeAllowedActions` starts from the profile capability set and then applies deterministic state gates for maturity, pregnancy, migration eligibility and predator legality before a request reaches fallback/Jev. Providers therefore cannot request `hunt` for a bison or invent an unregistered capability. A composed ecology module may define legal trophic role and prey edges as static game configuration, but neither Jev nor another Decision Provider can create or mutate those rules, family assignment, movement multipliers or outcomes at runtime. God View exposes family, archetype, organism form, movement mode/gait/controller limits and capabilities for inspection without affecting simulation or chunk generation. Fine controller speed is runtime-only momentum: it is initialized when an entity materializes and discarded when that fine entity unloads or transfers. The persisted world keeps position/state, while an unloaded chunk continues through coarse simulation; no frame velocity is treated as durable world truth.

### Organism form semantics

`WildlifeFormProfile` distinguishes `wild`, `domesticated`, and `monster` as code-owned species-form configuration. This is not an individual taming or ownership state. The current form contract contains two deterministic coarse modifiers only: `settlementSensitivity`, which scales the settlement carrying-capacity penalty, and `dangerSensitivity`, which scales how strongly danger reduces habitat suitability/capacity. Wild forms use the baseline values; domesticated forms are more tolerant of settlement pressure; monster forms remain more sensitive to settlements but less sensitive to environmental danger.

Sheep validates the domesticated form while reusing the existing open-plains, large-grazer and bovid modules. Warg validates the monster form while reusing temperate forest/hills, predator, canid and cursorial modules. Wolf/warg→sheep legality remains part of the shared static prey graph. Jev receives `organismForm` and movement mode only as read-only context under the existing wildlife budget, after deterministic capability/state filtering has already bounded the available actions. No provider can convert a wild individual into a domesticated one or alter form sensitivities.

### Authoritative individual domestication

Species form and individual domestication are separate authority layers. `form.kind === 'domesticated'` only permits the simulation to attach a normalized `WildlifeDomesticationState`; it does not pre-own an individual. The mutable state stores bounded tame progress, an optional durable owner ID, one owner command, breeding permission, and claim/interaction dates. Wild/monster species normalize this state away, so malformed saves or provider output cannot make an ineligible species tameable.

The initial first-person rule consumes one real grain per taming interaction and advances tame progress by a deterministic 25 points. Ownership is assigned only at 100. The owner can choose `none`, `follow`, `stay`, or `graze`; active commands execute inside deterministic simulation and remove that animal from provider batches. `graze` reuses the species' existing legal feeding action and resource-consumption rules rather than spawning food. `none` returns the individual to ordinary bounded wildlife decisions.

Reproduction checks owner permission at three points: legal `seek_mate` actions, actual mate selection, and authoritative conception. Unowned animals keep natural breeding. If ownership is involved, both parents must share the same owner and both have breeding enabled. Offspring from that permitted pair inherit the common owner with breeding disabled by default; if a father dies during gestation, his durable lineage domestication snapshot can supply the factual ownership state.

First-person `follow` also participates in the existing identity-preserving wildlife transfer system. When the player crosses to an adjacent fine chunk, followers attempt a conserved source→target population transfer before the source chunk folds. Target carrying capacity is checked first, represented population weight is conserved, destination position is committed only after transfer success, and lineage migration provenance records `reason='owner_follow'`. A failed transfer leaves the original source state unchanged.

God View preserves its out-of-world semantics. Entering God View clears player-follow paths and follow commands rest while the player entity is absent; the God camera cannot become an animal target or trigger transfer. Observer UI may display persisted ownership as world history, but provider perception receives an owner-anonymous domestication projection. The literal `ownerId='player'` is stripped before a wildlife request reaches Jev, and active owner-command animals bypass the provider entirely.

Living domestication state persists naturally in fine wildlife JSON and wildlife-transfer JSON. Durable lineage additionally stores nullable birth/death domestication snapshots. A later claim never rewrites birth history. Decision Providers cannot increment tame progress, consume grain, assign ownership, toggle breeding, issue owner commands, force inherited ownership, or bypass transfer conservation. See [Authoritative domestication](domestication.md) for the full state machine and persistence rules.

## Fine physics authority v1

Fine simulation now has one deterministic collision authority: `FinePhysicsAuthority` in `src/world/finePhysics.ts`. Navigation/controllers still produce desired motion, but they no longer apply position directly. Player input, NPC path following, and wildlife movement controllers submit a desired displacement plus a body radius; physics returns the only displacement that may be committed to authoritative fine position. Static colliders, authoritative doors, triggers, and terrain are indexed by a deterministic spatial hash so local movement/contact/ground queries inspect bounded candidates before applying the unchanged exact geometry tests; the index is only an acceleration structure and does not own simulation state.

Materialized static collision is represented as chunk-owned 2D AABBs. Buildings register their footprint, semantic solid WorldObjects register kind-specific bounds, and fine chunk teardown removes all colliders/triggers owned by that chunk. The previous runtime `blocked Set` has been removed, so A* path passability and physical movement query the same static geometry instead of maintaining two collision truths.

Kinematic bodies are circles. The solver sub-steps long displacement to prevent tunnelling, resolves axes independently to permit deterministic wall sliding, and rejects overlap with currently materialized player/NPC/wildlife circles. Slight restored/spawned overlap may move only in a direction that increases separation. Dynamic bodies are derived from current entity runtime state rather than persisted separately.

Targets such as wells, workstations, NPCs or prey often expose their center as the semantic navigation target while the center is physically occupied. If the final waypoint is blocked after entering the legal approach radius, the path is considered physically arrived; the higher-level authoritative action resolver still performs action-specific range/legality checks. Physics therefore determines contact/movement but never authorizes hunting, reproduction, crafting, trading or other gameplay outcomes.

Semantic triggers use the same chunk lifecycle but never block movement. First-person WorldObject interaction now requires both the existing visual/raycast target and overlap with the object's physics interaction trigger. This is the first live trigger consumer and provides the base for later doors, hazards, interiors and water/contact volumes.

God View keeps the hard observer invariant. The player dynamic collider exists only in first-person mode; God View camera movement adds no body, collider or trigger and cannot affect NPC/wildlife collision. Physics counts may be shown in world status only as read-only observability.

Unloaded chunks run no fine collision/contact solver. Their static physics is cleared on fold-back and dynamic bodies disappear with fine runtime entities, while coarse simulation remains authoritative. Fine physics adds no persistence schema.

Fine physics already owns chunk-scoped terrain height and ground contact, slope and ground-step limits, simulation-owned open/closed door colliders, and deterministic movement/contact for the licensed town cart. Door collider state is a physics foundation and is not yet wired into authored building-door gameplay. A complete general rigid-body engine, stacking/support and sleeping/wakeup rules, additional licensed movable archetypes and vehicles, and full projectile mechanics remain outside the current implementation. See [Physics](physics.md).

## Predator-pressure adaptation evidence

Predator pressure is modeled as an observational ecological signal separate from actual predation mortality. For each prey species in a coarse chunk, deterministic simulation scans the shared predator/prey graph, reads current predator population density relative to effective carrying capacity, weights that density by the shared prey preference, and maps the aggregate to a bounded 0–100 pressure. The strongest current predator→prey pair and mean chunk pressure are exposed in world status.

This pressure does **not** subtract health or population. Actual predation remains the only authoritative mechanism that removes prey, so recording predator pressure cannot double-count the ecological effect. The pressure instead answers a different question: how exposed was this species to predators during the time the named individual was actually observed in fine simulation?

Fine lineage habitat snapshots and time-weighted lifetime exposure therefore include optional `predatorPressure`. The existing fitness-by-habitat analysis treats it exactly like competition, seasonal suitability, and disease: living juveniles are right-censored until reproductive eligibility, dead individuals contribute completed lifespan outcomes, low/mid/high exposure bands are reported, and unavailable correlations remain unavailable rather than becoming false zero effects. The result is association evidence, not a causal claim that one trait changed because of predators.

## Predator/prey specialization evidence

Aggregate predator pressure answers how exposed a prey species was, but not which predator produced that exposure. Coarse predator-pressure state therefore retains the deterministic `predator → prey` pair decomposition used to form the aggregate signal. Each pair is still observational pressure derived from current predator density and the shared prey-preference table; it is not a kill event and never mutates prey state.

During actual fine simulation, lineage habitat exposure stores time-weighted `predatorSourceMean` for legal predators of the observed prey species. Legal predator sources that are currently absent contribute measured zero pressure. Historical lineage exposure that predates source decomposition remains unknown rather than being silently converted to zero; `predatorSourceObservedDays` is therefore tracked separately from total habitat observed days and is used as the denominator for source-level means.

Evolution statistics expose `predatorSpecialization` per prey species. For each predator source with at least one positive observed pressure, the deterministic analysis reports total samples, reproduction-eligible samples, dead/lifespan samples, observed source days, mean pressure, breeder/non-breeder pressure means, associations with reproduction/offspring/lifespan, and breeder-vs-eligible trait differentials. Reproductive outcomes use the same right-censoring rules as fitness-by-habitat; insufficient or zero-variance evidence remains unavailable rather than being forced to zero.

These remain association statistics, not causal attribution. Correlated biome, disease, migration, competition, or another predator source may explain part of an observed trait difference. God View exposes source identity and sample evidence instead of collapsing the result into a single adaptation score.

## Realized hunting and escape evidence

Predator pressure and predator-source specialization measure ecological exposure, not whether an actual chase or attack succeeded. Fine simulation now records realized predation outcomes only at deterministic action resolution. A Decision Provider may choose `hunt` or `flee` and a legal supplied target, but it cannot mark that action successful.

For a resolved hunt, the predator records a hunt attempt whenever the target species is known and legal under the shared predator graph. The attempt becomes a hit only when the target still exists and is within the deterministic attack distance; it becomes a kill only when deterministic damage reduces target health to zero. The prey records an attack received on a hit and a survived attack only when health remains above zero. A resolved flee records an attempt against the chosen legal predator and succeeds only when the threat is gone or the final deterministic separation reaches the configured safe distance.

These counters are stored in `WildlifeLineageRecord.predationOutcomes` with both overall totals and counterpart-species maps. Evolution statistics aggregate hunt hit/kill rate, escape rate and attack-survival rate and expose pair-level counts. For each observed pair they also compare traits of individuals that achieved at least one relevant success with all individuals that had a realized attempt/contact. Those trait differentials are observational evidence rather than causal claims and should be interpreted alongside sample counts, predator pressure, biome, disease and generation history.

The authority boundary remains unchanged: predator/prey legality, movement, attack distance, damage, health, death and all counters are deterministic simulation truth. Decision Providers only choose bounded behavior/targets and remain subject to the existing wildlife budget controller.

## Predator/prey trait matching and generation trends

Realized interaction evidence now preserves the traits of the actual two individuals involved in a fine-simulation event. For each resolved hunt, the predator-side evidence may store the sum of `predator traits − prey traits` for attempts, hits and kills. For each resolved flee, the prey-side evidence may store `prey traits − predator traits` for attempts and successful escapes. Received attacks similarly record prey-minus-predator deltas for all attacks and for survived attacks. These values come from the actual runtime target when present, or that target's durable lineage traits when the target disappeared before action resolution.

Trait sums are accompanied by independent paired-snapshot counts. This is required for backward compatibility: realized outcomes created before trait matching contain valid hunt/flee counts but no counterpart trait snapshot, so those old attempts must not enter the denominator of a trait-advantage mean. Missing paired evidence therefore remains missing instead of silently becoming zero or diluting later measurements.

For each species/counterpart pair, evolution statistics report actor-minus-counterpart mean trait advantages at three role-specific stages: attempt, successful intermediate outcome, and terminal outcome. Predator stages are attempt → hit → kill. Prey stages are flee attempt → successful escape plus received attack → survived attack. The same evidence is grouped by the actor's generation to expose realized hit/kill or escape/survival rates and paired trait advantages across generations.

These are descriptive interaction measurements, not causal selection estimates. A positive predator speed advantage among hits does not by itself prove selection for speed, because habitat, health, age, behavior choice, pathing, prey composition and correlated traits may also matter. God View presents coverage counts and recent generation outcomes so the evidence remains inspectable. Decision Providers continue to choose only bounded actions/targets and cannot alter traits, success labels, damage, survival or statistics.

## Multi-generation predator/prey coevolution evidence

The evidence layer now joins realized interaction performance, lineage reproductive outcomes and inherited trait trends at the predator→prey pair level. It deliberately does **not** align predator generation numbers with prey generation numbers. A fox generation 3 and rabbit generation 3 need not represent the same time cohort because species life histories, materialization windows and turnover rates differ. Each side therefore keeps its own generation series.

For every realized predator→prey pair, the predator side groups interacting predators by predator generation and reports hunt hit/kill performance, reproduction-eligible breeder rate, offspring mean, actor trait means and the already-recorded predator-minus-prey trait advantages. The prey side independently groups interacting prey by prey generation and reports escape/attack-survival performance, the same reproductive outcomes, prey trait means and prey-minus-predator advantages.

Within each side only, deterministic analysis computes generation slopes for performance, terminal performance, breeder rate, offspring mean and trait means. It also computes cross-generation correlations between realized performance and breeder/offspring outcomes and between realized performance and each trait mean. Correlations require at least three usable generation points and non-zero variance; trends require at least two usable points. Missing or constant evidence remains `null`, not zero.

A pair is marked bilateral only when both predator and prey sides contain realized evidence. One-sided historical evidence remains visible as partial evidence rather than being synthesized into an absent counterpart series. These measurements still do not prove coevolution: correlated habitat, population composition, disease, age structure, Decision Provider behavior choices and other traits can influence both performance and reproduction. God View and `GET /api/world/evolution` expose the underlying independent series and associations so later analysis can test stronger coevolution hypotheses without changing simulation authority.

## Multi-species interaction network observability

Predation, niche competition, and cross-species disease transmission now expose complete pair decompositions from the deterministic coarse ecology layer. Predation and disease edges are directed; niche competition is symmetric. The decompositions are additive optional fields so legacy coarse snapshots that only contain aggregate or strongest-pair summaries remain valid.

`computeWildlifeInteractionNetwork()` is a pure read-only derivation over coarse chunks. For each interaction kind it first counts only chunks that actually contain that kind's full pair decomposition. That count is the coverage denominator. Inside a covered chunk, a missing edge contributes zero pressure; a legacy chunk with no decomposition contributes no observation at all. This preserves the distinction between measured absence and unknown historical evidence.

Network edges report mean pressure over covered chunks, maximum observed pressure, active-chunk count, directionality and species endpoints. Species nodes aggregate population plus predation incoming/outgoing pressure, symmetric competition pressure, disease incoming/outgoing pressure and the number of active interaction kinds. None of these values feed back into carrying capacity, health, population, disease, predation or Decision Provider inputs; they are observability-only derived evidence.

The browser God View derives the network only from the bounded active chunk window and caches it briefly, so moving the out-of-world observer does not generate/explore chunks and the cost does not grow with persistent discovered-world history. The server endpoint `GET /api/world/interactions` derives the same structure from all persisted coarse chunks, providing a discovered-world research view. These two scopes are intentionally different and should not be compared without noting their chunk coverage.

## Network-linked competition and disease source evidence

The interaction network provides community-level edges, but evolutionary evidence needs the actual pressures experienced by named fine individuals. During observed fine lifetime intervals, lineage exposure now samples two additional source decompositions from the current coarse chunk: symmetric niche-competition pressure by counterpart species and incoming cross-species disease-transmission pressure by source species.

Each source family has its own time-weighted mean and its own source-observed-day denominator. If a legacy chunk lacks the full competition or disease pair decomposition, that interval does not count as source-observed time for that family. Once decomposition exists, a legal counterpart/source with measured zero pressure contributes a real zero. This preserves the distinction between unknown historical evidence and observed absence.

Evolution statistics derive source-specific fitness evidence for competition and disease using the same reproductive right-censoring rules as the existing fitness-by-habitat and predator-source layers. For each source species with at least one positive observed exposure, the analysis reports total samples, reproduction-eligible samples, lifespan samples, exposure mean, breeder/non-breeder exposure means, correlations with reproduction/offspring/lifespan, and breeder-vs-eligible trait differentials. Living juveniles do not enter reproductive outcomes before adulthood; dead juveniles remain completed non-reproductive outcomes.

These values are observational associations. A high goat-competition exposure associated with lower rabbit reproduction, or fox-origin disease exposure associated with a trait differential, does not prove that the source caused the outcome. Habitat, total density, season, predation, migration, age structure, correlated traits and other interaction edges may covary. God View therefore surfaces source identity, sample sizes and raw associations rather than producing a causal selection score.

## Generation-level competition and disease source evidence

Source-specific lifetime exposure is now grouped by the target species' own generation. For each competition or disease relationship, the evidence system builds an independent `target ← source` series containing observed individuals, reproduction-eligible individuals, deaths, mean source pressure, breeder rate, offspring mean, death-sample lifespan mean, trait mean and breeder trait differential.

Two species in the same relationship are never aligned by generation number. A rabbit generation 4 exposed to goats and a goat generation 4 exposed to rabbits are separate histories because turnover and observation windows differ. The reciprocal pair wrapper only places the two independent sides beside each other and marks whether both have observed source history; it does not manufacture synchronized cohorts or reciprocal causation.

Within each side, trends require at least two usable generation points. Correlations require at least three usable points and non-zero variance. Pressure-vs-breeder and pressure-vs-offspring use reproduction-eligible generation points. Pressure-vs-lifespan uses only the mean source pressure of dead individuals in each generation, matching the lifespan sample rather than mixing living exposure into a mortality outcome. Trait means use all source-observed individuals in that generation, so reproductive right-censoring does not alter the inherited-trait cohort itself.

God View presents recent raw generation points together with pressure, reproductive, lifespan and trait trends/associations. `GET /api/world/evolution` exports the same derived evidence from persisted lineage history. These remain observational measurements: bilateral trends can motivate reciprocal-selection hypotheses, but do not by themselves prove reciprocal selection.

## Multi-factor interaction selection evidence

Single-source correlations can be misleading when an animal experiences several pressures together. The evolution layer therefore derives outcome-specific multi-factor models from the durable predator-source, competition-source, and disease-source lifetime exposure means. These models remain read-only research evidence; they never alter health, reproduction, population, traits, or Decision Provider candidates.

Feature inclusion is coverage-aware. Missing source history is unknown, not zero. A candidate source must have at least six observed outcome-eligible samples, positive observed pressure, and non-zero variance. Features are added greedily only while the resulting complete-case set retains at least `max(8, 3 × featureCount)` samples, with a hard cap of six features. A model requires at least two varying source features. If coverage or outcome variance is insufficient, it is returned as explicitly non-estimable instead of emitting zero coefficients.

Before any regularized coefficient is emitted, the standardized **unregularized** predictor correlation matrix is diagnosed. The model is marked `unstable_collinearity` when that matrix is singular, when `max|rX| >= 0.98`, or when the maximum variance-inflation factor exceeds `10`; coefficients remain `null` in that state. This deliberately prevents ridge regularization from turning an unidentifiable exposure design into apparently precise evidence.

For each design that passes those diagnostics, predictors and outcome are standardized over the complete-case sample and the system solves a deterministic ridge regression with fixed `λ = 0.25`; coefficients are therefore standardized regularized associations (`β*`), not causal effects. Reproduction uses the right-censored breeder outcome, offspring uses reproduction-eligible offspring count, and lifespan uses only dead individuals. The model reports in-sample `R²`, maximum absolute pairwise predictor correlation (`max|rX|`), maximum VIF, and an explicit model status so fit and stability remain inspectable beside the coefficients.

The same lineage can support different feature sets for different outcomes because reproductive eligibility and death completion differ. This is intentional: no missing-data imputation is performed merely to force one common matrix. Synthetic tests use orthogonal exposure designs to verify coefficient direction and separate tests ensure disjoint legacy source coverage cannot be combined into a fabricated complete-case model.

## Multi-factor stability and generation-local evidence

A single pooled multi-factor model can still hide cohort dependence or regime changes. The evolution layer therefore derives deterministic sensitivity evidence from the same target-species lineage without introducing random resampling or causal claims. For each outcome it omits target-species generations and reruns the complete selection/coverage/collinearity pipeline. If the pooled model is unavailable because it has fewer than two recoverable features, insufficient complete-case samples, or globally zero outcome variance, generation subsets cannot create the missing coverage or variance; those mathematically unrecoverable cases skip sensitivity/local refits entirely. Collinearity and numerical failures are not skipped because a narrower cohort can genuinely resolve them. To keep long-running worlds bounded, histories of at most 12 generations test every generation; longer histories deterministically sample at most 12 generation probes spread from the earliest through the latest generation. The output records both all available generations and the exact tested-generation list. A replicate is coefficient-comparable only when it remains estimable with exactly the same feature set as the pooled model. Comparable replicates expose coefficient mean/range and sign consistency; sign consistency is reported only after at least three comparable refits. This is generation-omission sensitivity, not a confidence interval or p-value.

Time locality is deliberately bounded by what is actually persisted. `habitat_exposure_json` contains lifetime aggregate source means, not an exact within-lifetime exposure time series, so the system does **not** invent calendar-day local pressure histories. Instead it uses the target species' own generations as the temporal basis. For at most the six latest generation endpoints, it starts with that generation and expands backward for no more than eight target-species generations until the first estimable multi-factor model is found. The resulting window is the narrowest window supported within that bounded horizon by coverage, sample-size, outcome-variance and collinearity rules. If the horizon is exhausted while still unavailable, `searchTruncated` makes that limit explicit. Windows may overlap and remain descriptive observational evidence; generation numbers are never aligned across species.

God View surfaces pooled stability, comparable refit counts, coefficient sign/ranges, and recent generation-local models. `GET /api/world/evolution` exposes the same derived structure through each species' `multifactorSelection`; none of these calculations modify authoritative simulation state.

## Source-grounded presentation boundary

`scene/treePresentation.ts` and `scene/characterSoles.ts` adapt existing licensed geometry to semantic anchors and terrain without owning production, resources, identities or decisions. Trees derive basal static collision and a surrounding trigger in the existing physics authority; current animated soles adjust only a visual child, never the authoritative character position. Source-specific crop material preparation is offline, hash-guarded and preserves geometry. Read-only browser records expose the measured values without adding mutable test-control APIs. See [environment presentation](environment-presentation.md); no part of this layer lets God Camera movement discover or materialize chunks.

`SunShadowView` is a bounded render-only adapter: it follows first-person/observer focus with a fixed-size shadow map, fixed light direction and snapped orthographic volume, without consulting discovery or materialization. `world/characterContact.ts` separately supplies deterministic player/NPC motion constraints from calibrated source profiles; it never changes production/provider authority or replaces the body geometry used by tool/static queries. Ground-relative, viewport-clamped character dialogue labels likewise affect only presentation. None of these adapters changes the version-1 persistence schema.

Building WorldObject positions represent interaction frontage rather than a movable model anchor. Both home and streamed restore paths use `restoreBuildingForLayout` to preserve saved mutable state while keeping layout-owned body/collider/trigger transforms stable. This avoids a second interpretation of the same saved coordinate; version-1 persistence remains unchanged.

`KinematicMoveInput.constraints` contains pure signed-clearance queries used only by character motion. Source-local oriented NPC head rectangles and the player's disc share the same pair query in both motion directions; body circles and segment/tool/cart contacts are not enlarged.

Source-oriented NPC collision uses a persisted optional facing angle (`NpcState.heading`) in addition to X/Z position. Missing version-1 legacy values default to +Z; providers do not set the field. Baking work intents resolve to static-safe exterior source stances before physical execution, while transient player-driven yielding only adjusts an active path's local motor step. Neither system writes production results, changes semantic IDs, or grants God cameras a world entity.
