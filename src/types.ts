export type Vec2 = { x: number; z: number };
export type LocaleCode = 'zh-CN' | 'en' | 'ja' | 'es';

export type NpcRole = 'farmer' | 'baker' | 'shopkeeper' | 'guard' | 'maker' | 'resident';
export type Mood = 'happy' | 'calm' | 'neutral' | 'sad' | 'annoyed' | 'curious' | 'tired';
export type SocialIntent = 'greet' | 'smalltalk' | 'ask_help' | 'offer_help' | 'trade' | 'joke' | 'praise' | 'complain' | 'share_news' | 'leave';
export type StateShift = 'stable' | 'mood_up' | 'mood_down' | 'social_seek' | 'social_withdraw' | 'energy_conserve' | 'goal_intensify';
export type RelationEffect = 'positive' | 'neutral' | 'negative';

export type DecisionAction =
  | 'idle'
  | 'wander'
  | 'talk'
  | 'work'
  | 'rest'
  | 'eat'
  | 'pickup'
  | 'use_object'
  | 'inspect'
  | 'drop_item'
  | 'harvest'
  | 'craft'
  | 'trade'
  | 'gift'
  | 'deliver'
  | 'fetch_water'
  | 'patrol'
  | 'visit'
  | 'sleep'
  | 'explore';

export type ObjectKind =
  | 'bed'
  | 'bench'
  | 'workstation'
  | 'food_stall'
  | 'tree'
  | 'crate'
  | 'well'
  | 'water_patch'
  | 'farm_plot'
  | 'building'
  | 'road'
  | 'bush'
  | 'rock'
  | 'flower'
  | 'cart'
  | 'tool_prop'
  | 'dropped_item';

export type InteractionCapability =
  | 'inspect'
  | 'rest'
  | 'sit'
  | 'sleep'
  | 'draw_water'
  | 'drink'
  | 'wash'
  | 'harvest'
  | 'forage'
  | 'chop'
  | 'mine'
  | 'craft'
  | 'work'
  | 'buy'
  | 'sell'
  | 'trade'
  | 'store'
  | 'take'
  | 'load'
  | 'unload'
  | 'pickup'
  | 'visit';

export type ItemKind = 'apple' | 'bread' | 'wood' | 'coin' | 'flower' | 'grain' | 'flour' | 'water' | 'stone' | 'plank' | 'tool';

export interface InventoryItem {
  kind: ItemKind;
  count: number;
}

export interface RelationshipState {
  affinity: number;
  trust: number;
  familiarity: number;
}

export interface NpcMemory {
  id: string;
  at: number;
  summary: string;
  importance: number;
}

export interface NpcState {
  continuation?: import('./world/actorContinuation.js').NpcContinuation;
  id: string;
  /** Accepted random events; absent legacy cursors start at zero. */
  randomEventCursor?: number;
  chunkId?: string;
  name: string;
  role: NpcRole;
  position: Vec2;
  /** Authoritative facing for oriented contact; omitted legacy version-1 saves face +Z. */
  heading?: number;
  home: Vec2;
  workAt?: string;
  mood: Mood;
  hunger: number;
  energy: number;
  social: number;
  money: number;
  inventory: InventoryItem[];
  relationships: Record<string, RelationshipState>;
  memories: NpcMemory[];
  currentAction: DecisionAction;
  targetNpcId?: string;
  targetObjectId?: string;
  goal: string;
  lastDecisionAt: number;
  lastDialogue?: string;
}

export type RigidBodyArchetypeId = 'cart';

export interface WorldObjectState {
  id: string;
  chunkId?: string;
  kind: ObjectKind;
  name: string;
  position: Vec2;
  tags: string[];
  usable: boolean;
  pickupable: boolean;
  /** Canonical deterministic rigid-body semantics. Rendering follows authoritative position. */
  rigidBodyArchetype?: RigidBodyArchetypeId;
  /** @deprecated Legacy persisted flag; upgraded to rigidBodyArchetype on load. */
  movable?: boolean;
  /** @deprecated Legacy persisted radius; used only while upgrading old movable snapshots. */
  physicsRadius?: number;
  item?: ItemKind;
  capabilities?: InteractionCapability[];
  storage?: InventoryItem[];
  resourceAmount?: number;
  resourceCapacity?: number;
  respawnAt?: number;
  occupiedBy?: string;
}

export interface NearbyNpc {
  id: string;
  name: string;
  role: NpcRole | 'player';
  mood: Mood;
  distance: number;
  isPlayer?: boolean;
  relationship: RelationshipState;
  currentAction: DecisionAction;
}

export interface NearbyObject {
  id: string;
  kind: ObjectKind;
  name: string;
  tags: string[];
  distance: number;
  usable: boolean;
  pickupable: boolean;
  item?: ItemKind;
  capabilities?: InteractionCapability[];
}

export interface DecisionWorldSnapshot {
  gameTime: string;
  minuteOfDay: number;
  weather: string;
  nearbyNpcs: NearbyNpc[];
  nearbyObjects: NearbyObject[];
  recentEvents: string[];
}

export interface DecisionRequest {
  npc: NpcState;
  world: DecisionWorldSnapshot;
  allowedActions: DecisionAction[];
}

export interface DecisionResponse {
  source: string;
  action: DecisionAction;
  targetNpcId?: string;
  targetObjectId?: string;
  socialIntent?: SocialIntent;
  stateShift: StateShift;
  commitment: number;
  confidence: number;
  reasonCode: string;
  raw?: unknown;
}

export interface DialogueActor {
  id: string;
  name: string;
  role: string;
  mood: Mood | string;
  relationship?: RelationshipState;
}

export interface DialogueRequest {
  locale?: LocaleCode | string;
  speaker: DialogueActor;
  listener: DialogueActor;
  situation: string;
  intent: SocialIntent;
  world: {
    gameTime: string;
    weather: string;
    nearbyTags: string[];
  };
  recentLines: string[];
}

export interface DialogueResponse {
  source: string;
  mode: 'line' | 'fragments';
  text: string;
  selectedIds: string[];
  confidence: number;
  relationEffect: RelationEffect;
}

export type DialogueKind = 'line' | 'fragment';
export type FragmentSlot = 'opener' | 'body' | 'closer';

export interface DialogueEntry {
  id: string;
  locale?: LocaleCode | string;
  kind: DialogueKind;
  slot?: FragmentSlot;
  text: string;
  tags: string[];
  intents: SocialIntent[];
  moods: string[];
  roles: string[];
  weight: number;
}

export interface ImportDialogueRequest {
  format: 'plain' | 'jsonl' | 'json';
  locale?: LocaleCode | string;
  text: string;
}


export type ChunkBiome = 'plains' | 'forest' | 'hills' | 'wetlands' | 'dryland';
export type ChunkStrategy = 'sustain' | 'grow_settlement' | 'conserve' | 'extract_resources' | 'fortify' | 'trade_route';
export type ChunkMigrationPolicy = 'attract' | 'retain' | 'release' | 'evacuate';
export type ChunkEcologyPolicy = 'recover' | 'balance' | 'harvest' | 'protect';

export type WildlifeSpecies = 'rabbit' | 'deer' | 'boar' | 'goat' | 'fox' | 'wolf' | 'badger' | 'lynx' | 'bison' | 'raccoon' | 'sheep' | 'warg';
export type WildlifeAction = 'graze' | 'forage' | 'drink' | 'rest' | 'flee' | 'hunt' | 'wander' | 'seek_mate' | 'migrate';
export type WorldSeason = 'spring' | 'summer' | 'autumn' | 'winter';

export interface PlantBiomassState {
  grass: number;
  shrub: number;
  fruit: number;
  crop: number;
}

export interface TrophicFluxState {
  primaryProduction: number;
  herbivory: number;
  predation: number;
  mortalityReturn: number;
}

export interface WildlifeCompetitionPair {
  speciesA: WildlifeSpecies;
  speciesB: WildlifeSpecies;
  nicheOverlap: number;
  pressure: number;
}

export interface WildlifeNicheCompetitionState {
  speciesPressure: Partial<Record<WildlifeSpecies,number>>;
  meanPressure: number;
  /** Full symmetric pair decomposition; absent in legacy snapshots. */
  pairs?: WildlifeCompetitionPair[];
  strongestPair?: WildlifeCompetitionPair;
}

export interface WildlifeDiseasePair {
  fromSpecies: WildlifeSpecies;
  toSpecies: WildlifeSpecies;
  pressure: number;
}

export interface WildlifeDiseasePressureState {
  environmentalPressure: number;
  speciesPressure: Partial<Record<WildlifeSpecies,number>>;
  localContactPressure: Partial<Record<WildlifeSpecies,number>>;
  crossSpeciesPressure: Partial<Record<WildlifeSpecies,number>>;
  importedPressure: Partial<Record<WildlifeSpecies,number>>;
  meanPressure: number;
  /** Full directed cross-species transmission decomposition; absent in legacy snapshots. */
  pairs?: WildlifeDiseasePair[];
  strongestPair?: WildlifeDiseasePair;
}

export interface WildlifePredatorPressurePair {
  predatorSpecies: WildlifeSpecies;
  preySpecies: WildlifeSpecies;
  pressure: number;
}

export interface WildlifePredatorPressureState {
  speciesPressure: Partial<Record<WildlifeSpecies,number>>;
  meanPressure: number;
  pairs?: WildlifePredatorPressurePair[];
  strongestPair?: WildlifePredatorPressurePair;
}

export type WildlifeInteractionKind = 'predation' | 'competition' | 'disease';

export interface WildlifeInteractionEdge {
  kind: WildlifeInteractionKind;
  fromSpecies: WildlifeSpecies;
  toSpecies: WildlifeSpecies;
  directed: boolean;
  coverageChunks: number;
  activeChunks: number;
  meanPressure: number;
  maxPressure: number;
}

export interface WildlifeInteractionNode {
  species: WildlifeSpecies;
  population: number;
  predationIncoming: number;
  predationOutgoing: number;
  competitionPressure: number;
  diseaseIncoming: number;
  diseaseOutgoing: number;
  activeInteractionKinds: number;
}

export interface WildlifeInteractionNetwork {
  chunks: number;
  coverage: Record<WildlifeInteractionKind,number>;
  nodes: WildlifeInteractionNode[];
  edges: WildlifeInteractionEdge[];
  strongestByKind: Partial<Record<WildlifeInteractionKind,WildlifeInteractionEdge>>;
}

export interface CoarseWildlifePopulation {
  species: WildlifeSpecies;
  count: number;
  carryingCapacity: number;
  health: number;
  diseaseLoad?: number;
  competitionPressure?: number;
  importedDiseasePressure?: number;
  predatorPressure?: number;
}

export interface WildlifeTraits {
  speed: number;
  size: number;
  fertility: number;
  wariness: number;
}

export interface WildlifeMorphologyPhenotype {
  /** Multipliers relative to the species morphology profile. */
  bodyLength: number;
  bodyHeight: number;
  legLength: number;
  headScale: number;
  tailScale: number;
}

export interface WildlifeBehaviorPhenotype {
  /** Higher values cause earlier resource-seeking under hunger. */
  forageDrive: number;
  /** Higher values lower the habitat-improvement threshold for migration. */
  migrationDrive: number;
  /** Higher values tolerate predators at shorter distances before fleeing. */
  riskTolerance: number;
  /** Higher values trigger recovery/rest at milder disease or fatigue. */
  recoveryDrive: number;
}

export interface WildlifePhenotype {
  morphology: WildlifeMorphologyPhenotype;
  behavior: WildlifeBehaviorPhenotype;
}

export type WildlifeOrganismFamily='lagomorph'|'cervid'|'suiform'|'caprine'|'canid'|'mustelid'|'felid'|'bovid'|'procyonid';

export interface WildlifeOrganismGenome {
  family: WildlifeOrganismFamily;
  material: {
    /** HSL hue offset applied to the species material palette. */
    hueShift: number;
    /** HSL lightness offset applied to the body/accent palette. */
    lightnessShift: number;
    /** Relative accent-vs-body hue separation. */
    accentShift: number;
  };
  niche: {
    /** Multipliers over non-zero species plant-use axes; zero species axes remain impossible. */
    grass: number;
    shrub: number;
    fruit: number;
    crop: number;
  };
  locomotion: {
    /** Bounded stride tendency; contributes speed with an energy trade-off. */
    stride: number;
    /** Bounded endurance tendency; reduces locomotion cost with a small speed trade-off. */
    endurance: number;
  };
}

export interface WildlifeOrganismLocomotion {
  speedMultiplier: number;
  energyMultiplier: number;
}

export interface WildlifeOrganismGenomeVector {
  material: {
    hueShift: number;
    lightnessShift: number;
    accentShift: number;
  };
  niche: {
    grass: number;
    shrub: number;
    fruit: number;
    crop: number;
  };
  locomotion: {
    stride: number;
    endurance: number;
  };
}

export interface WildlifeOrganismGenomeStats {
  family: WildlifeOrganismFamily | null;
  sampleSize: number;
  comparableSamples: number;
  birthTrackedSamples: number;
  founderSeedSamples: number;
  legacyUpgradeSamples: number;
  mean: WildlifeOrganismGenomeVector | null;
  variance: WildlifeOrganismGenomeVector | null;
  trendPerGeneration: WildlifeOrganismGenomeVector | null;
  breederMean: WildlifeOrganismGenomeVector | null;
  breederDifferential: WildlifeOrganismGenomeVector | null;
}

export interface WildlifeFunctionalPhenotype {
  /** Multiplies trait-based movement speed. */
  movementSpeedMultiplier: number;
  /** Continuous locomotion energy cost while pathing. */
  movementEnergyMultiplier: number;
  /** Basal hunger/thirst/energy maintenance cost. */
  maintenanceMultiplier: number;
  /** Hunger relief gained from the same deterministic food consumption. */
  forageEfficiency: number;
  /** Energy restored by the same deterministic rest action. */
  recoveryEfficiency: number;
  /** Extra cost applied to flee/hunt/migrate intensity. */
  fastActionEnergyMultiplier: number;
}

export interface WildlifeNullablePhenotype {
  morphology: {
    bodyLength: number | null;
    bodyHeight: number | null;
    legLength: number | null;
    headScale: number | null;
    tailScale: number | null;
  };
  behavior: {
    forageDrive: number | null;
    migrationDrive: number | null;
    riskTolerance: number | null;
    recoveryDrive: number | null;
  };
}

export type WildlifePhenotypeProvenance = 'birth' | 'founder_seed' | 'legacy_upgrade';

export interface WildlifePhenotypeStats {
  sampleSize: number;
  comparableSamples: number;
  birthTrackedSamples: number;
  founderSeedSamples: number;
  legacyUpgradeSamples: number;
  mean: WildlifePhenotype | null;
  variance: WildlifePhenotype | null;
  trendPerGeneration: WildlifePhenotype | null;
  breederMean: WildlifePhenotype | null;
  breederDifferential: WildlifePhenotype | null;
}

export interface WildlifePhenotypeBiomeFitnessStats {
  biome: ChunkBiome;
  sampleSize: number;
  reproductionEligibleSamples: number;
  lifespanSamples: number;
  observedExposureDaysMean: number;
  phenotypeMean: WildlifePhenotype | null;
  breederDifferential: WildlifePhenotype | null;
  reproductionAssociation: WildlifeNullablePhenotype;
  offspringAssociation: WildlifeNullablePhenotype;
  lifespanAssociation: WildlifeNullablePhenotype;
}

export interface WildlifeHabitatSnapshot {
  biome: ChunkBiome;
  ecology: number;
  food: number;
  water: number;
  danger: number;
  settlementLevel: number;
  plantBiomass: number;
  /** Species-specific coarse niche pressure observed at this habitat snapshot; absent in legacy records. */
  competitionPressure?: number;
  /** Species-specific seasonal habitat suitability observed at this snapshot; absent in legacy records. */
  seasonalSuitability?: number;
  /** Species-specific disease transmission pressure observed at this snapshot; absent in legacy records. */
  diseasePressure?: number;
  /** Species-specific predator pressure observed at this snapshot; absent in legacy records. */
  predatorPressure?: number;
}

export interface WildlifeHabitatExposure {
  observedDays: number;
  habitatMean: Omit<WildlifeHabitatSnapshot,'biome'>;
  /** Time-weighted predator-source pressure for the observed prey species; absent in legacy/unobserved records. */
  predatorSourceMean?: Partial<Record<WildlifeSpecies,number>>;
  /** Days with explicit predator-source decomposition; kept separate so legacy unknown history is not treated as zero pressure. */
  predatorSourceObservedDays?: number;
  /** Time-weighted niche-competition pressure by counterpart species; absent in legacy/unobserved records. */
  competitionSourceMean?: Partial<Record<WildlifeSpecies,number>>;
  competitionSourceObservedDays?: number;
  /** Time-weighted incoming cross-species disease pressure by source species; absent in legacy/unobserved records. */
  diseaseSourceMean?: Partial<Record<WildlifeSpecies,number>>;
  diseaseSourceObservedDays?: number;
  biomeDays: Partial<Record<ChunkBiome,number>>;
  chunkDays: Record<string,number>;
  observedTransitions: number;
  lastObservedDay?: number;
  lastChunk?: string;
  lastBiome?: ChunkBiome;
}

export type WildlifeSelectionSignal = 'insufficient' | 'weak' | 'persistent';

export type WildlifeDeathReason = 'predation' | 'starvation' | 'dehydration' | 'disease' | 'senescence' | 'other';

export interface WildlifeMigrationEvent {
  fromChunkId: string;
  toChunkId: string;
  day: number;
  fromBiome: ChunkBiome;
  toBiome: ChunkBiome;
  representedPopulation: number;
  reason: 'behavioral_migration' | 'owner_follow';
}

export interface WildlifePredatorOutcomeCounter {
  huntAttempts: number;
  huntHits: number;
  kills: number;
  /** Sum of predator minus prey traits across resolved hunt attempts; optional in legacy records. */
  attemptTraitDeltaSum?: WildlifeTraits;
  /** Number of hunt attempts that carried both actor/counterpart trait snapshots. */
  attemptTraitMatchCount?: number;
  /** Sum of predator minus prey traits across hunt hits. */
  hitTraitDeltaSum?: WildlifeTraits;
  /** Number of hunt hits with paired trait snapshots. */
  hitTraitMatchCount?: number;
  /** Sum of predator minus prey traits across kills. */
  killTraitDeltaSum?: WildlifeTraits;
  /** Number of kills with paired trait snapshots. */
  killTraitMatchCount?: number;
}

export interface WildlifePreyOutcomeCounter {
  fleeAttempts: number;
  successfulEscapes: number;
  attacksReceived: number;
  survivedAttacks: number;
  /** Sum of prey minus predator traits across resolved flee attempts; optional in legacy records. */
  fleeTraitDeltaSum?: WildlifeTraits;
  /** Number of flee attempts with paired trait snapshots. */
  fleeTraitMatchCount?: number;
  /** Sum of prey minus predator traits across successful escapes. */
  escapeTraitDeltaSum?: WildlifeTraits;
  /** Number of successful escapes with paired trait snapshots. */
  escapeTraitMatchCount?: number;
  /** Sum of prey minus predator traits across attacks received. */
  attackTraitDeltaSum?: WildlifeTraits;
  /** Number of received attacks with paired trait snapshots. */
  attackTraitMatchCount?: number;
  /** Sum of prey minus predator traits across survived attacks. */
  survivedAttackTraitDeltaSum?: WildlifeTraits;
  /** Number of survived attacks with paired trait snapshots. */
  survivedAttackTraitMatchCount?: number;
}

export interface WildlifePredationOutcomes {
  asPredator: WildlifePredatorOutcomeCounter & {
    byPrey: Partial<Record<WildlifeSpecies,WildlifePredatorOutcomeCounter>>;
  };
  asPrey: WildlifePreyOutcomeCounter & {
    byPredator: Partial<Record<WildlifeSpecies,WildlifePreyOutcomeCounter>>;
  };
}

export interface WildlifeLineageRecord {
  entityId: string;
  species: WildlifeSpecies;
  motherId?: string;
  fatherId?: string;
  birthDay: number;
  deathDay?: number;
  deathReason?: WildlifeDeathReason;
  generation: number;
  birthChunk: string;
  deathChunk?: string;
  traitsAtBirth: WildlifeTraits;
  traitsAtDeath?: WildlifeTraits;
  /** Immutable inherited phenotype; absent in lineage rows created before phenotype tracking. */
  phenotypeAtBirth?: WildlifePhenotype;
  phenotypeAtDeath?: WildlifePhenotype;
  /** Distinguishes tracked birth inheritance from deterministic founder seeding and legacy upgrade observation. */
  phenotypeProvenance?: WildlifePhenotypeProvenance;
  organismGenomeAtBirth?: WildlifeOrganismGenome;
  organismGenomeAtDeath?: WildlifeOrganismGenome;
  organismGenomeProvenance?: WildlifePhenotypeProvenance;
  /** Factual individual domestication snapshots; no causal evolutionary interpretation is implied. */
  domesticationAtBirth?: WildlifeDomesticationState;
  domesticationAtDeath?: WildlifeDomesticationState;
  birthHabitat?: WildlifeHabitatSnapshot;
  deathHabitat?: WildlifeHabitatSnapshot;
  habitatExposure?: WildlifeHabitatExposure;
  migrationHistory?: WildlifeMigrationEvent[];
  /** Deterministic fine-simulation hunt/flee/contact outcomes; absent in legacy records. */
  predationOutcomes?: WildlifePredationOutcomes;
  origin: 'founder' | 'reproduction';
  offspringCount: number;
  reproductiveSuccess: boolean;
}

export interface WildlifeGenerationCohortStats {
  generation: number;
  population: number;
  living: number;
  deaths: number;
  meanLifespan: number;
  offspringMean: number;
  breederRate: number;
  traitMean: WildlifeTraits;
  traitVariance: WildlifeTraits;
  phenotypeSamples: number;
  phenotypeMean: WildlifePhenotype | null;
  phenotypeVariance: WildlifePhenotype | null;
}

export type WildlifeFitnessExposureDimension = 'competitionPressure' | 'seasonalSuitability' | 'diseasePressure' | 'predatorPressure';
export type WildlifeFitnessBand = 'low' | 'medium' | 'high';

export interface WildlifeFitnessBandStats {
  band: WildlifeFitnessBand;
  population: number;
  eligiblePopulation: number;
  living: number;
  deaths: number;
  breeders: number;
  breederRate: number;
  offspringMean: number;
  lifespanMean: number;
  exposureMean: number;
  traitMean: WildlifeTraits;
  breederTraitMean: WildlifeTraits;
  selectionDifferential: WildlifeTraits;
}

export interface WildlifeHabitatFitnessStats {
  dimension: WildlifeFitnessExposureDimension;
  sampleSize: number;
  reproductionEligibleSamples: number;
  lifespanSamples: number;
  observedExposureDaysMean: number;
  exposureMean: number;
  breederExposureMean: number | null;
  nonBreederExposureMean: number | null;
  reproductionAssociation: number | null;
  offspringAssociation: number | null;
  lifespanAssociation: number | null;
  bands: WildlifeFitnessBandStats[];
}

export interface WildlifePredatorSpecializationStats {
  predatorSpecies: WildlifeSpecies;
  sampleSize: number;
  reproductionEligibleSamples: number;
  lifespanSamples: number;
  observedExposureDaysMean: number;
  pressureMean: number;
  breederPressureMean: number | null;
  nonBreederPressureMean: number | null;
  reproductionAssociation: number | null;
  offspringAssociation: number | null;
  lifespanAssociation: number | null;
  traitMean: WildlifeTraits;
  breederTraitMean: WildlifeTraits;
  selectionDifferential: WildlifeTraits;
}

export interface WildlifeInteractionSourceFitnessStats {
  kind: 'competition' | 'disease';
  sourceSpecies: WildlifeSpecies;
  sampleSize: number;
  reproductionEligibleSamples: number;
  lifespanSamples: number;
  observedExposureDaysMean: number;
  pressureMean: number;
  breederPressureMean: number | null;
  nonBreederPressureMean: number | null;
  reproductionAssociation: number | null;
  offspringAssociation: number | null;
  lifespanAssociation: number | null;
  traitMean: WildlifeTraits;
  breederTraitMean: WildlifeTraits;
  selectionDifferential: WildlifeTraits;
}

export interface WildlifeInteractionSourceGenerationCohort {
  generation: number;
  observedIndividuals: number;
  eligibleIndividuals: number;
  deaths: number;
  pressureMean: number;
  breeders: number;
  breederRate: number;
  offspringMean: number;
  lifespanMean: number;
  lifespanPressureMean: number;
  traitMean: WildlifeTraits;
  breederTraitMean: WildlifeTraits;
  selectionDifferential: WildlifeTraits;
}

export interface WildlifeInteractionSourceGenerationEvidence {
  kind: 'competition' | 'disease';
  targetSpecies: WildlifeSpecies;
  sourceSpecies: WildlifeSpecies;
  generations: WildlifeInteractionSourceGenerationCohort[];
  generationsObserved: number;
  observedIndividuals: number;
  pressureTrendPerGeneration: number | null;
  breederTrendPerGeneration: number | null;
  offspringTrendPerGeneration: number | null;
  lifespanTrendPerGeneration: number | null;
  traitTrendPerGeneration: WildlifeNullableTraits;
  pressureBreederAssociation: number | null;
  pressureOffspringAssociation: number | null;
  pressureLifespanAssociation: number | null;
  pressureTraitAssociation: WildlifeNullableTraits;
}

export interface WildlifeReciprocalInteractionSelectionEvidence {
  kind: 'competition' | 'disease';
  speciesA: WildlifeSpecies;
  speciesB: WildlifeSpecies;
  bothSidesObserved: boolean;
  sideA: WildlifeInteractionSourceGenerationEvidence;
  sideB: WildlifeInteractionSourceGenerationEvidence;
}

export interface WildlifePredationGenerationPerformance {
  generation: number;
  observedIndividuals: number;
  attempts: number;
  successes: number;
  successRate: number;
  terminalAttempts: number;
  terminalSuccesses: number;
  terminalSuccessRate: number;
  traitMatchAttempts: number;
  traitMatchSuccesses: number;
  terminalTraitMatchSuccesses: number;
  attemptTraitAdvantageMean: WildlifeTraits;
  successTraitAdvantageMean: WildlifeTraits;
  terminalTraitAdvantageMean: WildlifeTraits;
}

export interface WildlifePredationPairPerformance {
  role: 'predator' | 'prey';
  counterpartSpecies: WildlifeSpecies;
  observedIndividuals: number;
  huntAttempts: number;
  huntHits: number;
  kills: number;
  huntHitRate: number;
  huntKillRate: number;
  fleeAttempts: number;
  successfulEscapes: number;
  escapeRate: number;
  attacksReceived: number;
  survivedAttacks: number;
  attackSurvivalRate: number;
  traitMean: WildlifeTraits;
  successfulTraitMean: WildlifeTraits;
  successTraitDifferential: WildlifeTraits;
  traitMatchAttempts: number;
  traitMatchSuccesses: number;
  terminalTraitMatchSuccesses: number;
  /** Actor minus counterpart trait means for role-specific attempts/successes. */
  attemptTraitAdvantageMean: WildlifeTraits;
  successTraitAdvantageMean: WildlifeTraits;
  terminalTraitAdvantageMean: WildlifeTraits;
  generationTrend: WildlifePredationGenerationPerformance[];
}

export interface WildlifeRealizedPredationStats {
  huntAttempts: number;
  huntHits: number;
  kills: number;
  huntHitRate: number;
  huntKillRate: number;
  fleeAttempts: number;
  successfulEscapes: number;
  escapeRate: number;
  attacksReceived: number;
  survivedAttacks: number;
  attackSurvivalRate: number;
  pairs: WildlifePredationPairPerformance[];
}

export interface WildlifeNullableTraits {
  speed: number | null;
  size: number | null;
  fertility: number | null;
  wariness: number | null;
}

export interface WildlifeCoevolutionGenerationEvidence {
  generation: number;
  observedIndividuals: number;
  eligibleIndividuals: number;
  attempts: number;
  successes: number;
  successRate: number;
  terminalAttempts: number;
  terminalSuccesses: number;
  terminalSuccessRate: number;
  breeders: number;
  breederRate: number;
  offspringMean: number;
  traitMean: WildlifeTraits;
  attemptTraitAdvantageMean: WildlifeTraits;
  successTraitAdvantageMean: WildlifeTraits;
  terminalTraitAdvantageMean: WildlifeTraits;
}

export interface WildlifeCoevolutionSideEvidence {
  species: WildlifeSpecies;
  role: 'predator' | 'prey';
  generations: WildlifeCoevolutionGenerationEvidence[];
  generationsObserved: number;
  interactingIndividuals: number;
  performanceTrendPerGeneration: number | null;
  terminalPerformanceTrendPerGeneration: number | null;
  breederTrendPerGeneration: number | null;
  offspringTrendPerGeneration: number | null;
  traitTrendPerGeneration: WildlifeNullableTraits;
  performanceBreederAssociation: number | null;
  terminalPerformanceBreederAssociation: number | null;
  performanceOffspringAssociation: number | null;
  terminalPerformanceOffspringAssociation: number | null;
  performanceTraitAssociation: WildlifeNullableTraits;
  terminalPerformanceTraitAssociation: WildlifeNullableTraits;
}

export interface WildlifeCoevolutionPairEvidence {
  predatorSpecies: WildlifeSpecies;
  preySpecies: WildlifeSpecies;
  bothSidesObserved: boolean;
  predator: WildlifeCoevolutionSideEvidence;
  prey: WildlifeCoevolutionSideEvidence;
}

export type WildlifeMultifactorOutcome = 'reproduction' | 'offspring' | 'lifespan';
export type WildlifeMultifactorModelStatus =
  | 'estimable'
  | 'insufficient_features'
  | 'insufficient_samples'
  | 'no_outcome_variance'
  | 'unstable_collinearity'
  | 'numerical_failure';

export interface WildlifeMultifactorFeatureCoefficient {
  kind: 'predation' | 'competition' | 'disease';
  sourceSpecies: WildlifeSpecies;
  coverageSamples: number;
  coverageRate: number;
  mean: number;
  stdDev: number;
  standardizedCoefficient: number | null;
}

export interface WildlifeMultifactorOutcomeEvidence {
  outcome: WildlifeMultifactorOutcome;
  estimable: boolean;
  status: WildlifeMultifactorModelStatus;
  baseSamples: number;
  samples: number;
  candidateFeatures: number;
  selectedFeatures: number;
  ridgeLambda: number;
  rSquared: number | null;
  maxFeatureCorrelation: number | null;
  maxVarianceInflationFactor: number | null;
  coefficients: WildlifeMultifactorFeatureCoefficient[];
}

export interface WildlifeMultifactorCoefficientStability {
  kind: 'predation' | 'competition' | 'disease';
  sourceSpecies: WildlifeSpecies;
  comparableReplicates: number;
  coefficientMean: number | null;
  coefficientMin: number | null;
  coefficientMax: number | null;
  signConsistency: number | null;
}

export interface WildlifeMultifactorLeaveOneGenerationOutEvidence {
  availableGenerations: number;
  testedGenerations: number[];
  attemptedReplicates: number;
  estimableReplicates: number;
  comparableReplicates: number;
  coefficients: WildlifeMultifactorCoefficientStability[];
}

export interface WildlifeMultifactorLocalWindowEvidence {
  startGeneration: number;
  endGeneration: number;
  generations: number[];
  searchTruncated: boolean;
  model: WildlifeMultifactorOutcomeEvidence;
}

export interface WildlifeMultifactorOutcomeStabilityEvidence {
  outcome: WildlifeMultifactorOutcome;
  basis: 'target_species_generation';
  leaveOneGenerationOut: WildlifeMultifactorLeaveOneGenerationOutEvidence;
  localWindows: WildlifeMultifactorLocalWindowEvidence[];
}

export interface WildlifeMultifactorSelectionEvidence {
  species: WildlifeSpecies;
  models: WildlifeMultifactorOutcomeEvidence[];
  stability: WildlifeMultifactorOutcomeStabilityEvidence[];
}

export interface WildlifeBiomeSelectionStats {
  basis: 'origin' | 'lifetime';
  biome: ChunkBiome;
  population: number;
  breeders: number;
  generationsObserved: number;
  breederRate: number;
  offspringMean: number;
  lifespanMean: number;
  observedExposureDaysMean: number;
  habitatMean: Omit<WildlifeHabitatSnapshot,'biome'>;
  traitMean: WildlifeTraits;
  breederTraitMean: WildlifeTraits;
  selectionDifferential: WildlifeTraits;
  normalizedSelectionDifferential: WildlifeTraits;
  selectionConsistency: WildlifeTraits;
  comparableSelectionGenerations: WildlifeTraits;
  traitTrendPerGeneration: WildlifeTraits;
  signal: Record<keyof WildlifeTraits, WildlifeSelectionSignal>;
}

export interface WildlifeEvolutionStats {
  species: WildlifeSpecies;
  livingPopulation: number;
  historicalPopulation: number;
  births: number;
  deaths: number;
  generationMean: number;
  generationMax: number;
  lifespanMean: number;
  offspringMean: number;
  traitMean: WildlifeTraits;
  traitVariance: WildlifeTraits;
  traitTrendPerGeneration: WildlifeTraits;
  phenotype: WildlifePhenotypeStats;
  phenotypeBiomeFitness: WildlifePhenotypeBiomeFitnessStats[];
  organismGenome: WildlifeOrganismGenomeStats;
  mortality: Record<WildlifeDeathReason, number>;
  reproductiveSuccess: number;
  survivalToReproductionRate: number;
  cohorts: WildlifeGenerationCohortStats[];
  biomeSelection: WildlifeBiomeSelectionStats[];
  lifetimeBiomeSelection: WildlifeBiomeSelectionStats[];
  exposureFitness: WildlifeHabitatFitnessStats[];
  predatorSpecialization: WildlifePredatorSpecializationStats[];
  interactionSourceFitness: WildlifeInteractionSourceFitnessStats[];
  multifactorSelection: WildlifeMultifactorSelectionEvidence;
  realizedPredation: WildlifeRealizedPredationStats;
}

export type WildlifeDomesticationCommand = 'none' | 'follow' | 'stay' | 'graze';

export interface WildlifeDomesticationState {
  /** 0..100 deterministic taming progress; ownership requires 100. */
  tameProgress: number;
  /** Durable world-entity owner identifier. Current player ownership uses the stable id "player". */
  ownerId?: string;
  /** Mutable owner command. Player-targeting commands are suspended outside first-person mode. */
  command: WildlifeDomesticationCommand;
  /** Owned animals may reproduce only when explicitly enabled. */
  breedingAllowed: boolean;
  claimedDay?: number;
  lastInteractionDay?: number;
}

export interface WildlifeState {
  continuation?: import('./world/actorContinuation.js').WildlifeContinuation;
  id: string;
  /** Accepted random events; absent legacy cursors start at zero. */
  randomEventCursor?: number;
  chunkId: string;
  species: WildlifeSpecies;
  position: Vec2;
  ageDays: number;
  health: number;
  hunger: number;
  thirst: number;
  energy: number;
  sex: 'female' | 'male';
  generation: number;
  traits: WildlifeTraits;
  /** Additive for save compatibility; runtime normalizes missing legacy values deterministically. */
  phenotype?: WildlifePhenotype;
  /** Family-constrained material/niche/locomotion genes; additive for legacy saves. */
  organismGenome?: WildlifeOrganismGenome;
  /** Mutable per-individual domestication authority; distinct from immutable species organism form. */
  domestication?: WildlifeDomesticationState;
  currentAction: WildlifeAction;
  targetObjectId?: string;
  targetWildlifeId?: string;
  targetChunkId?: string;
  lastDecisionAt: number;
  birthDay: number;
  diseaseLoad?: number;
  motherId?: string;
  fatherId?: string;
  pregnantById?: string;
  pregnantUntilDay?: number;
  lastBirthDay?: number;
  /** Coarse population represented by this named fine individual after identity-preserving migration. */
  representedPopulation?: number;
}

export interface WildlifeMigrationCandidate {
  id: string;
  biome: ChunkBiome;
  distance: number;
  ecology: number;
  food: number;
  water: number;
  danger: number;
  settlementLevel: number;
  population: number;
  carryingCapacity: number;
  density: number;
  competitionPressure: number;
  seasonalSuitability: number;
  diseasePressure: number;
}

export interface WildlifeDecisionRequest {
  wildlife: WildlifeState;
  world: {
    gameTime: string;
    minuteOfDay: number;
    weather: string;
    currentHabitat: WildlifeMigrationCandidate;
    nearbyChunks: WildlifeMigrationCandidate[];
    nearbyResources: Array<{ id:string; tags:string[]; distance:number; resourceAmount?:number }>;
    nearbyWildlife: Array<{ id:string; species:WildlifeSpecies; sex:'female'|'male'; ageDays:number; distance:number; health:number; currentAction:WildlifeAction; mateAvailable:boolean }>;
  };
  allowedActions: WildlifeAction[];
}

export interface WildlifeDecisionResponse {
  source: string;
  action: WildlifeAction;
  targetObjectId?: string;
  targetWildlifeId?: string;
  targetChunkId?: string;
  confidence: number;
  reasonCode: string;
}

export interface WildlifeDecisionResult extends WildlifeDecisionResponse {
  wildlifeId: string;
}

export interface WildlifeDecisionBatchRequest {
  requests: WildlifeDecisionRequest[];
}

export interface WildlifeDecisionBatchResponse {
  source: string;
  decisions: WildlifeDecisionResult[];
}

export interface CoarseChunkState {
  id: string;
  cx: number;
  cz: number;
  biome: ChunkBiome;
  settlementLevel: number;
  population: number;
  food: number;
  wood: number;
  water: number;
  ecology: number;
  danger: number;
  prosperity: number;
  strategy: ChunkStrategy;
  migrationPolicy: ChunkMigrationPolicy;
  ecologyPolicy: ChunkEcologyPolicy;
  plants?: PlantBiomassState;
  trophicFlux?: TrophicFluxState;
  nicheCompetition?: WildlifeNicheCompetitionState;
  wildlifeDisease?: WildlifeDiseasePressureState;
  wildlifePredatorPressure?: WildlifePredatorPressureState;
  wildlife?: CoarseWildlifePopulation[];
  lastDecisionAt: number;
  decisionVersion: number;
}

export interface ChunkDecisionRequest {
  day: number;
  gameTime: string;
  weather: string;
  chunks: CoarseChunkState[];
}

export interface ChunkDecision {
  chunkId: string;
  strategy: ChunkStrategy;
  migrationPolicy: ChunkMigrationPolicy;
  ecologyPolicy: ChunkEcologyPolicy;
  confidence: number;
  reasonCode: string;
  source: string;
}

export interface ChunkDecisionResponse {
  source: string;
  decisions: ChunkDecision[];
}

export type RegionPriority =
  | 'balanced'
  | 'food_security'
  | 'trade_network'
  | 'settlement_growth'
  | 'ecology_recovery'
  | 'security_coordination';

export type RegionMovementPolicy = 'open' | 'stabilize' | 'redistribute' | 'restrict';
export type RegionEcologyPolicy = 'restore_corridors' | 'balanced_use' | 'protected_network' | 'productive_landscape';

export interface RegionState {
  id: string;
  rx: number;
  rz: number;
  chunkIds: string[];
  population: number;
  settlements: number;
  food: number;
  wood: number;
  water: number;
  ecology: number;
  danger: number;
  prosperity: number;
}

export interface RegionDecisionRequest {
  day: number;
  gameTime: string;
  weather: string;
  regions: RegionState[];
}

export interface RegionDecision {
  regionId: string;
  priority: RegionPriority;
  movementPolicy: RegionMovementPolicy;
  ecologyPolicy: RegionEcologyPolicy;
  confidence: number;
  reasonCode: string;
  source: string;
}

export interface RegionDecisionResponse {
  source: string;
  decisions: RegionDecision[];
}

export type WorldPriority = 'resilience' | 'prosperity' | 'expansion' | 'ecology' | 'security' | 'exploration';
export type WorldConnectivityPolicy = 'localism' | 'balanced_networks' | 'trade_corridors' | 'migration_corridors';
export type WorldGrowthPolicy = 'steady' | 'compact' | 'frontier' | 'conserve';

export interface WorldStrategicSummary {
  population: number;
  settlements: number;
  food: number;
  wood: number;
  water: number;
  ecology: number;
  danger: number;
  prosperity: number;
  activeRegions: number;
}

export interface WorldDecisionRequest {
  day: number;
  gameTime: string;
  weather: string;
  summary: WorldStrategicSummary;
  regions: RegionDecision[];
}

export interface WorldDecision {
  priority: WorldPriority;
  connectivity: WorldConnectivityPolicy;
  growth: WorldGrowthPolicy;
  confidence: number;
  reasonCode: string;
  source: string;
}

export interface WorldDecisionResponse {
  source: string;
  decision: WorldDecision;
}


export interface PersistedWildlifeTransfer {
  entityId: string;
  state: WildlifeState;
  fromChunkId: string;
  toChunkId: string;
  representedPopulation: number;
  transferredDay: number;
}

export interface PersistedFineChunk {
  chunkId: string;
  /** False means static state exists but dynamic simulation has never been activated. */
  dynamicActivated?: boolean;
  npcStates: NpcState[];
  objectStates: WorldObjectState[];
  wildlifeStates?: WildlifeState[];
}

export interface WorldRandomness {
  version: 1;
  seed: string;
}

export interface WorldPersistenceMeta {
  streamedLayoutVersion?: 1;
  randomness?: WorldRandomness;
  day: number;
  minuteOfDay: number;
  weather: string;
  /** Last processed six-hour weather block; -1 means selection is pending. */
  weatherEpoch?: number;
  playerPosition: Vec2;
  playerInventory: Record<ItemKind, number>;
}

export interface WorldPersistenceSnapshot {
  version: 1;
  meta: WorldPersistenceMeta;
  streamedLayouts?: import('./world/streamedLayouts.js').StreamedLayout[];
  coarseChunks: CoarseChunkState[];
  fineChunks: PersistedFineChunk[];
  homeNpcs: NpcState[];
  homeObjects: WorldObjectState[];
  wildlifeLineage?: WildlifeLineageRecord[];
  wildlifeTransfers?: PersistedWildlifeTransfer[];
  savedAt?: number;
}

