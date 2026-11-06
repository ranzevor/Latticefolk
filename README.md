<p align="center">
  <img src="docs/assets/cover.svg" alt="Latticefolk — a living autonomous NPC world" width="100%" />
</p>

<h1 align="center">Latticefolk</h1>

<p align="center">
  <strong>A 3D web sandbox for autonomous NPC towns and evolving simulated worlds.</strong><br/>
  Pluggable decision engines choose bounded intent; deterministic simulation owns world state.
</p>

<p align="center">
  <a href="https://github.com/wangfumin1/Latticefolk/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/wangfumin1/Latticefolk/ci.yml?branch=main&label=CI&logo=github"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-2ea44f"></a>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white">
  <img alt="Three.js" src="https://img.shields.io/badge/Three.js-r180-black?logo=threedotjs">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%E2%89%A520-339933?logo=nodedotjs&logoColor=white">
  <img alt="Decision providers" src="https://img.shields.io/badge/decision%20engines-pluggable-6f42c1">
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="docs/README.zh-CN.md">简体中文</a> ·
  <a href="docs/README.ja.md">日本語</a> ·
  <a href="docs/README.es.md">Español</a>
</p>

> [!NOTE]
> Latticefolk is under active development. The current build is already playable, but the long-term target is much larger: streamed procedural worlds, coarse↔fine simulation, persistent societies, ecosystems, life cycles, evolution, and richer physics.

## Why Latticefolk?

Most AI NPC demos stop at conversation. Latticefolk treats decisions as part of a **world simulation**: NPCs work, harvest, craft, trade, deliver, visit, patrol, rest, sleep, explore, manipulate resources, build relationships, and choose authored dialogue. Distant regions are simulated as coarse chunks and can also receive model-assisted policy decisions.

The project is deliberately **not tied to Jev**. Jev / TypeSafe System One is the first remote decision adapter, while the simulation talks only to the provider-neutral `DecisionProvider` contract.

## Current highlights

- **Source-grounded scene recovery**: adult-scale trunk-anchored trees, current skinned-sole support, bounded contact-shadow coverage, source-calibrated player/head clearance and hash-pinned dielectric crop materials. Full scene/pose/journey recovery remains in progress; see [presentation scope](docs/environment-presentation.md).

- **Playable Three.js town** with first-person controls and an out-of-world God View.
- **20 bounded NPC actions** including work, harvest, craft, trade, gift, delivery, water collection, patrol, visits, sleep, and exploration.
- **Unified interactive world objects**: buildings, wells, market stalls, workstations, storage, carts, trees, rocks, flowers, tools, beds, and more expose explicit capabilities instead of being decorative-only.
- **Authoritative deterministic simulation** for movement, pathfinding, inventory, money, relationships, needs, and legal state transitions.
- **Pluggable decision engines** with a deterministic fallback and optional Jev adapter.
- **Jev-aware distant chunks**: far regions keep population/resource/ecology/prosperity state and receive batched strategy, migration, and ecology decisions.
- **First coarse↔fine streaming pass**: entering a distant chunk in first person materializes representative residents, settlement sites, and resources; leaving folds fine consequences back into coarse state.
- **SQLite-backed world persistence**: coarse policies/resources, visited fine entities, center-town state, player progress, time, and weather survive restarts.
- **Conserved regional exchange**: migration and coarse resource trade move explicitly from one chunk to another instead of appearing/disappearing independently.
- **Hierarchical strategic decisions**: Chunk → Region → World policies run at slower cadences as scope increases, while deterministic systems remain authoritative.
- **Streamed persistent exploration**: first-person travel can push beyond the original map edge while only a bounded active chunk window is rendered; explored chunk history persists.
- **Semantic procedural settlements**: biome, strategy, danger and prosperity shape settlement archetypes, roads, building functions, work sites and resource layout; generated content remains interactive.
- **Deterministic production chains**: NPCs and players share the same conserved recipe graph, currently including grain → flour → bread and wood → plank → tool.
- **Persistent wildlife ecology**: rabbit, deer, boar, goat, fox, wolf, badger, lynx, bison, raccoon, sheep, and warg exist as coarse populations and fine persistent individuals with needs, hunting/fleeing, migration, reproduction, inheritable traits, and bounded batched behavior decisions.
- **Plant biomass and lifecycle ecology**: seasonal grass/shrub/fruit/crop biomass, trophic flows, disease pressure, pregnancy/litters, senescence, parent IDs, and inherited mutation connect habitat to multi-generation life.
- **Durable evolution observability**: dead and living wildlife share a persistent ancestry archive with founder/reproductive birth provenance, death causes, lifetime offspring counts, per-generation trait mean/variance/trends, reproductive-success metrics, lineage traversal, and a God View observatory.
- **Biome-linked selection evidence**: lineage habitat snapshots let God View compare breeders with their cohort, show normalized trait differentials and cross-generation consistency, and distinguish insufficient/weak/persistent evidence without claiming causality.
- **Observed lifetime habitat exposure**: materialized wildlife accumulates time-weighted environmental exposure and biome/chunk duration; God View can compare origin-biome and lifetime-dominant-biome selection evidence without inventing named-animal history during coarse simulation.
- **Identity-preserving wildlife migration**: named fine animals can move to legal adjacent chunks while retaining lineage/state; deterministic simulation owns carrying-capacity checks, conserved coarse transfer, representative weights, transit persistence, and migration history.
- **Deterministic niche competition**: fixed species resource profiles and current density produce explicit competition pressure, bounded effective-capacity penalties, God View visibility, and competition-aware lineage habitat evidence.
- **Seasonal wildlife migration**: species/biome seasonal suitability changes conserved coarse migration pressure and bounded fine migration choices while preserving capacity, population conservation and lineage evidence.
- **Richer disease transmission**: environmental, same-species, cross-species and migration-import pressures deterministically update wildlife disease load; fine contacts and lineage exposure use the same bounded transmission model.
- **Profile-driven wildlife diversity**: one simulation-owned `WildlifeSpeciesProfile` drives trophic role, biome/season affinity, niche/resource use, growth/carrying capacity, fine trait baselines, legal feeding/hunting behavior, life history, predation and procedural morphology. Badger validates the mixed omnivore path by both foraging and hunting rabbit, while wolf can predate badger.
- **Heritable wildlife phenotype**: bounded morphology multipliers (body/leg/head/tail proportions) and behavior drives (forage, migration, risk tolerance, recovery) are deterministically seeded, inherited and mutated. They affect wildlife presentations and bounded decision tendencies, persist across saves/transfers, and are archived with explicit birth/founder/legacy-upgrade provenance for God View generation trends and breeder differentials. Phenotype now also maps into narrow deterministic locomotion, maintenance, forage-efficiency, recovery and fast-action energy trade-offs; phenotype-by-dominant-biome evidence relates comparable birth/founder phenotype to reproduction, offspring and lifespan without treating legacy upgrades as historical observations.
- **Constrained organism families**: each wildlife species belongs to a simulation-owned organism family (`lagomorph`, `cervid`, `suiform`, `caprine`, `canid`, `mustelid`, `felid`, `bovid`, `procyonid`). Family ownership now comes from the species/body archetype itself rather than a duplicate species→family table. Fine individuals carry a deterministic, heritable family genome for material variation, legal plant-niche preference and locomotion stride/endurance. The family envelope cannot create impossible trophic abilities or rewrite the coarse food web; genome effects stay bounded, persist through fine chunks/transfers/lineage, are read-only to Decision Providers, and are summarized in God View by sample provenance, means, variance, generation trends and breeder differentials.
- **Reusable organism archetypes**: habitat, ecology/trophic niche, procedural body/family, movement mode, semantic wildlife capabilities, organism form, and life-history modules compose one `WildlifeSpeciesProfile`. Lynx/bison/raccoon validate predator/herbivore/omnivore composition; sheep adds a `domesticated` bovid form and warg adds a `monster` canid form while reusing existing family/ecology modules. The same registry drives coarse ecology, materialization, legal actions, movement cost/speed, predator relations, family-genome inheritance, lineage/evolution and God View without species-specific simulation branches. Most wildlife uses procedural morphology; raccoons use a pinned Quaternius model with [inherited instance proportions and palette](docs/raccoon-presentation.md).
- **Bounded organism forms**: `wild`, `domesticated`, and `monster` remain immutable simulation-owned species archetypes that affect deterministic coarse settlement/danger sensitivity. `domesticated` means only that a species is eligible for the separate per-individual domestication system; it never implies that every individual is already tame or owned.
- **Authoritative individual domestication**: domestication-capable wildlife now carries persisted per-individual tame progress, owner, owner command, breeding permission, claim/interaction dates, and durable birth/death lineage snapshots. First-person taming consumes real grain, ownership is established only at the deterministic threshold, `follow/stay/graze/none` commands bypass Decision Providers, same-owner breeding permission is enforced at candidate + reproduction time, offspring can inherit ownership, and adjacent first-person `follow` transfers reuse conserved wildlife migration with explicit `owner_follow` provenance. God View only observes this state; player-follow is suspended there, and provider payloads strip owner identity.
- **Deterministic wildlife movement controllers**: movement modes now carry gait, acceleration/deceleration, turn-rate and waypoint-arrival semantics in addition to speed/energy multipliers. Fine wildlife accelerates and turns through a pure controller step; the resulting desired displacement is resolved by the dedicated fine physics authority. Per-frame speed/heading are transient fine-runtime state; unloaded chunks continue under coarse simulation rather than persisting meaningless frame velocity.
- **Fine physics authority v1**: player, NPC and wildlife displacement now resolves through one deterministic physics layer with chunk-scoped static AABBs, circular kinematic bodies, anti-tunnelling substeps, wall sliding, dynamic character collision and non-blocking semantic triggers. The former runtime `blocked Set` is removed as a second collision truth; A* passability queries physics geometry. First-person object interaction also requires physics-trigger overlap, while God View contributes no player body. The first Physics v2 increment also registers materialized chunk terrain in the same authority and enforces bounded slope/ground-step legality. Doors, general rigid bodies, stacking and projectile/contact queries remain later phases. See [Physics](docs/physics.md).
- **Predator-pressure evidence**: each prey species gets a deterministic 0–100 pressure derived from actual predator density and shared prey preference; the signal is observational, enters lineage exposure/fitness evidence, and never duplicates damage or population loss.
- **Predator-source specialization**: predator→prey pressure is retained per source and time-weighted across observed fine-simulation lifetime exposure; source-specific outcome associations and breeder trait differentials are visible without causal overclaiming.
- **Realized hunting/escape evidence**: deterministic fine action resolution records hunt attempts/hits/kills, flee attempts/successes and attack survival per counterpart species; Decision Providers choose intent but never declare success.
- **Predator/prey trait matching**: actual interacting individuals contribute actor-minus-counterpart trait deltas for hunt, escape and attack-survival evidence, with explicit paired-snapshot coverage and generation-level outcome trends.
- **Multi-generation coevolution evidence**: each realized predator→prey pair keeps independent predator-side and prey-side generation series connecting interaction success, reproductive outcomes and inherited trait trends; sparse/constant evidence remains non-estimable rather than becoming a false zero.
- **Multi-species interaction network**: predation, symmetric niche competition, and directed cross-species disease transmission are exposed as one derived network with per-kind coverage and node in/out pressure; active God View stays bounded while the server can summarize the persisted discovered world.
- **Network-linked niche/disease evidence**: named fine individuals accumulate observed competition pressure by counterpart species and incoming disease pressure by source species; source-specific right-censored fitness evidence relates those exposures to reproduction, offspring, lifespan, and breeder trait differentials without causal overclaiming.
- **Competition/disease generation evidence**: each source relationship is grouped into independent target←source generation series; pressure, breeder/offspring/lifespan and trait trends are compared only within one species-side history, while bilateral evidence never assumes synchronized generations or reciprocal causation.
- **Multi-factor interaction selection evidence**: simultaneous predator/competition/disease source pressures are evaluated with complete-case standardized ridge models for reproduction, offspring, and lifespan; missing legacy exposure is never zero-imputed, and God View shows coverage, coefficients, R², and predictor collinearity rather than a causal verdict.
- **Fitness-by-habitat evidence**: lifetime competition, seasonal suitability, disease exposure, and predator pressure are associated with reproduction, offspring count and lifespan using right-censored reproductive eligibility; God View shows total/eligible/dead samples, low/mid/high cohorts and trait differentials without causal overclaiming.
- **Token and cost controls** visible in the God-mode console: minute/hour/day input-token budgets, daily USD guard, confidence threshold, cache TTL, call-class statistics, and presets.
- **Authored dialogue retrieval** with line/fragment composition instead of unconstrained text generation.
- **Multilingual dialogue corpus and UI**: Simplified Chinese, English, Japanese, and Spanish.
- **CC0 low-poly assets** from Quaternius, with provenance tracked in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Quick start

Requirements: **Node.js 20+**.

```bash
git clone https://github.com/wangfumin1/Latticefolk.git
cd Latticefolk
cp .env.example .env
npm install
npm run dev
```

Windows users can run `run.bat` or `run.ps1`.

Open the Vite URL printed by the terminal, usually `http://localhost:5173`.

## Verification

Run deterministic checks with `npm run check`. Gameplay-facing changes also use `npm run test:e2e`, which starts the real server and Vite client in Chromium, enters the Three.js world, exercises first-person movement and God View observer semantics, and captures screenshots/traces as evidence. CI treats browser E2E as a separate quality gate; unit/typecheck/build success alone is not considered playable or visual verification.

### Optional Jev provider

The default `DECISION_PROVIDER=auto` keeps the game usable without any remote key.

```dotenv
DECISION_PROVIDER=jev
TYPESAFE_API_KEY=your_server_side_key
JEV_ENDPOINT=https://api.typesafe.ai/v1/systemone
JEV_MODEL=jev-latest
```

Provider credentials stay on the server. Never expose them to browser code.

See [Decision providers](docs/decision-providers.md) for token budgets, confidence gating, caching, batching, and runtime administration. World save behavior is documented in [Persistence](docs/persistence.md), and individual ownership/taming rules are documented in [Authoritative domestication](docs/domestication.md).

## Controls

| Mode | Controls |
| --- | --- |
| First person | `WASD` move · `Shift` run · mouse look · `E` interact |
| God View | `G` toggle · left-drag orbit · right-drag pan · wheel zoom · `WASD` pan · `Q/E` rotate · `F` focus · `Space` recenter |
| Console | `Tab` |

**God View is observer-only.** Entering it removes the player entity from NPC perception and decision targets; moving the observer camera does not affect the simulation.

## Decision architecture

```text
                         ┌─────────────────────────────┐
                         │        World State          │
                         └──────────────┬──────────────┘
                                        │ bounded perception
                         ┌──────────────▼──────────────┐
                         │      DecisionProvider       │
                         │ fallback · Jev · future...  │
                         └──────────────┬──────────────┘
                                        │ typed intent
          ┌─────────────────────────────▼────────────────────────────┐
          │               Deterministic Simulation                  │
          │ legality · pathfinding · inventory · economy · physics  │
          └───────────┬───────────────────────────┬──────────────────┘
                      │                           │
            ┌─────────▼─────────┐       ┌────────▼─────────┐
            │ Fine local world │       │ Coarse far world │
            │ NPCs / objects   │       │ chunks / policy  │
            └───────────────────┘       └──────────────────┘
```

A model never directly mutates arbitrary numbers or invents world facts. It chooses among bounded legal options; game systems execute and validate consequences.

## Jev call optimization

The current adapter is designed around **useful decisions per input token**, not maximum request frequency.

- deterministic emergency short-circuits for obvious hunger/exhaustion cases;
- unnecessary questions omitted when no matching action is legal;
- trimmed memories, events, visible object fields, and dialogue candidates;
- short-lived response cache for identical decision payloads;
- confidence gating with safe fallback / policy hold;
- distant chunks batched into one System One query;
- independent budgets for calls, minute/hour/day input tokens, and daily estimated spend.

The God-mode console exposes **Economy / Balanced / Quality** presets plus manual controls. Production runtime budget edits are opt-in through `ALLOW_RUNTIME_ADMIN=true`.

## Dialogue and languages

Latticefolk uses a retrieval-first authored corpus:

```text
large corpus
   ↓ local tags / role / mood / intent / locale retrieval
small candidate set
   ↓ bounded decision
complete line OR opener + body + closer
   ↓
exact authored text
```

The repository currently includes a versioned multilingual seed corpus for **zh-CN, English, Japanese, and Spanish**, while user imports are preserved separately in the runtime dialogue file.

See [Dialogue library](docs/dialogue-library.md) and [Internationalization](docs/i18n.md).

## Repository map

```text
src/
  main.ts                  Three.js game runtime
  i18n.ts                  UI localization
  world/                   world simulation layers
server/
  decision/
    providers/             fallback / Jev adapters
    budget.ts              token & cost budget controller
  dialogueStore.ts         indexed authored-dialogue store
data/
  dialogue-seed.multilingual.jsonl
public/assets/             redistributable game assets
docs/                      architecture, roadmap and language docs
tests/                     deterministic/provider budget tests
.github/                   CI and contribution templates
```

## Roadmap

The current development order is intentionally architecture-first:

1. ✅ first-pass coarse ↔ fine chunk materialization;
2. ✅ world persistence / SQLite;
3. ✅ conserved migration, resource, trade, and ecology flows across chunks;
4. ✅ Region / World level decision layers;
5. ✅ dynamic chunk streaming and real travel;
6. procedural settlements, buildings, environments, and content;
7. richer production chains and interactions;
8. ✅ first ecological food-web/lifecycle systems;
9. ✅ durable lineage, evolution statistics, and biome-linked selection observability;
10. ✅ identity-preserving fine wildlife migration, niche competition, seasonal movement, richer disease transmission, fitness-by-habitat, expanded food webs, predator-pressure observability, predator/prey specialization, realized hunting/escape evidence, predator/prey trait matching, multi-generation coevolution evidence, multi-species interaction-network observability, network-linked competition/disease source evidence, reciprocal generation-level source observability, multi-factor selection/stability evidence, profile-driven species diversity, heritable morphology/behavior phenotype observability, deterministic phenotype→function trade-offs, phenotype-by-biome fitness evidence, first constrained organism-family genomes, reusable organism archetype composition, movement/capability modules, and composed lynx/bison/raccoon coverage, plus bounded wild/domesticated/monster form archetypes, deterministic gait/acceleration/turn wildlife controllers, and authoritative per-individual domestication ownership/taming/commands/breeding with conserved owner-follow transfers; next: dedicated physics/character-controller integration.

See the living [Roadmap](docs/roadmap.md) and [Long-term vision](docs/long-term-vision.md). Documentation is updated as each implementation stage lands.

## Development

```bash
npm run typecheck
npm test
npm run build
# all checks
npm run check
```

Pull requests should preserve the authority boundary between **decision intent** and **simulation mutation**. Read [CONTRIBUTING.md](CONTRIBUTING.md) and [Architecture](docs/architecture.md) first.

## Credits

Latticefolk builds on excellent open-source work and freely redistributable art:

- **Three.js** — browser 3D rendering and scene infrastructure.
- **Quaternius** — CC0 Cube World, Ultimate Fantasy RTS, and Medieval Village assets used by the current demo. See [third-party notices](THIRD_PARTY_NOTICES.md).
- **TypeSafe / Jev System One** — optional typed probabilistic decision-provider integration and inspiration for bounded decision workflows.
- All contributors, testers, issue reporters, and future world-builders.

Third-party names and trademarks belong to their respective owners. Inclusion here does not imply endorsement.

## Citation

If Latticefolk is useful in research, demos, teaching, or derivative simulation work, you can cite the repository using [CITATION.cff](CITATION.cff). GitHub will expose the **Cite this repository** action automatically.

## License

Source code is licensed under [MIT](LICENSE). Bundled third-party assets retain their original licenses; currently redistributed Quaternius assets used by the demo are CC0 and documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).


Run local validation with `npm run validate:local`. Source snapshots and browser results are written to a unique system temporary directory, using a dedicated E2E database. See [local validation](docs/local-validation.md).

Bakers now approach a source-derived exterior oven stance before producing; optional NPC facing is retained through compatible version-1 saves so oriented contact survives reload.
