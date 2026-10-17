import './style.css';
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CoarseWorldRuntime } from './world/coarseWorld';
import { seasonalHabitatSuitability, wildlifeDiseaseContactCoefficient } from './world/ecology';
import { computeWildlifeInteractionNetwork } from './world/interactionNetwork';
import { planFineChunk } from './world/materialization';
import { restoreBuildingForLayout } from './world/buildingRestore';
import { craftAtWorkstation } from './world/production';
import { PortableObjectRuntime } from './world/portableObjectRuntime';
import { dueNpcDecisions } from './world/npcDecisionScheduling';
import { advancePickupRespawn, droppedItemCount, portableItemMetrics, restoredPlayerPosition } from './world/portableObjects';
import { droppedParcelLabel, droppedParcelSpec } from './scene/droppedParcel';
import { WATER_PATCH_ASSET, waterPatchVisualSpec } from './scene/waterPatch';
import { CharacterSoles } from './scene/characterSoles';
import { WildlifePresentation } from './scene/wildlifePresentation';
import { WildlifeVisualRuntime } from './scene/wildlifeVisualRuntime';
import { SunShadowView } from './scene/sunShadow';
import { characterOverlay } from './scene/characterOverlay';
import { PLAYER_BODY_RADIUS, NPC_BODY_RADIUS, characterHeadEnvelope, playerHeadClearance, playerHeadConstraint, npcHeadConstraint, safeNpcHeading, npcPlayerSeparation, PLAYER_CONVERSATION_REACH, reachedPlayerConversation } from './world/characterContact';
import { stepNpcYield, type NpcYieldPlan } from './world/npcYield';
import { bakingWorkApproach, type NpcWorkApproach } from './world/npcWorkApproach';
import { fitTreeModel, treePhysics, treeVisualHeight } from './scene/treePresentation';
import { BAKING_OVEN_ASSET, bakingOvenVisualSpec, bakingOvenPhysics, isBakingOven } from './scene/bakingOven';
import { applyFineWildlifePopulationTransfer, areAdjacentChunks, fineMigrationEntryPoint, foldFineWildlifePopulationCount } from './world/fineWildlifeMigration';
import { accumulateWildlifeHabitatExposure, computeEvolutionStatistics, computeWildlifeCoevolutionEvidence, computeWildlifeInteractionSelectionEvidence, dominantWildlifeExposureBiome, lineageAncestors } from './world/evolution';
import { wildlifeLifeHistory as getWildlifeLifeHistory } from './world/wildlifeLifeHistory';
import { canWildlifePredate, isWildlifePredator, WILDLIFE_SPECIES, wildlifeHungerRelief, wildlifePredationDamage, wildlifeSpeciesProfile } from './world/wildlifeSpecies';
import { effectiveWildlifeMorphology, inheritWildlifePhenotype, normalizeWildlifePhenotype, wildlifeFunctionalPhenotype } from './world/wildlifePhenotype';
import { inheritWildlifeOrganismGenome, normalizeWildlifeOrganismGenome, wildlifeGenomePlantConsumptionWeights, wildlifeOrganismLocomotion, wildlifeResourceNicheScore } from './world/organismFamilies';
import { recordWildlifeAttackReceived, recordWildlifeFleeOutcome, recordWildlifeHuntOutcome } from './world/predationOutcomes';
import { stepWildlifeMovementController } from './world/wildlifeMovementController';
import { FinePhysicsAuthority, type DynamicCollider } from './world/finePhysics';
import { normalizeWorldObjectRigidBody, resolveMovableBodyStep, worldObjectRigidBody } from './world/movablePhysics';
import { resolveContactAttack } from './world/contactCombat';
import { resolveContactAction } from './world/contactAction';
import { registerFineTerrainForChunk, registerHomeTerrain } from './world/fineTerrain';
import { feedWildlifeForTaming, inheritedWildlifeDomestication, isWildlifeDomesticationEligible, normalizeWildlifeDomestication, setWildlifeBreedingPermission, setWildlifeDomesticationCommand, wildlifeBreedingAllowed, wildlifeDomesticationDecisionState, wildlifeHasActiveOwnerCommand, wildlifePairBreedingAllowed } from './world/domestication';
import { I18n, SUPPORTED_LOCALES } from './i18n';
import type {
  DecisionAction, DecisionRequest, DecisionResponse, DialogueRequest, DialogueResponse,
  CoarseChunkState, InteractionCapability, ItemKind, Mood, NpcRole, NpcState, PersistedFineChunk, PersistedWildlifeTransfer, SocialIntent, Vec2, WildlifeAction, WildlifeDeathReason, WildlifeCoevolutionPairEvidence, WildlifeCoevolutionSideEvidence, WildlifeDecisionBatchRequest, WildlifeDecisionBatchResponse, WildlifeDecisionResult, WildlifeEvolutionStats, WildlifeInteractionNetwork, WildlifeInteractionSourceGenerationEvidence, WildlifeLineageRecord, WildlifeMigrationCandidate, WildlifePredationPairPerformance, WildlifeReciprocalInteractionSelectionEvidence, WildlifeDomesticationCommand, WildlifeSpecies, WildlifeState, WorldObjectState, WorldPersistenceSnapshot
} from './types';

const WORLD_SIZE = 72;
const HALF = WORLD_SIZE / 2;
const keyOf = (x:number,z:number) => `${x},${z}`;
const clamp = (v:number,min:number,max:number) => Math.max(min,Math.min(max,v));
const dist = (a:Vec2,b:Vec2) => Math.hypot(a.x-b.x,a.z-b.z);
const now = () => performance.now();
const i18n = new I18n(localStorage.getItem('latticefolk.locale') || navigator.language);

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
<div id="game"></div>
<div id="crosshair">+</div>
<div id="modeBar"><button id="modeBtn">${i18n.t('mode.god')}</button><span id="modeHint">${i18n.t('mode.first')}</span><select id="localeSelect" aria-label="Language">${SUPPORTED_LOCALES.map(x=>`<option value="${x.code}" ${x.code===i18n.locale?'selected':''}>${x.label}</option>`).join('')}</select></div>
<div id="hud">
  <div class="brand">${i18n.t('brand')}</div>
  <div id="clock"></div>
  <div id="decisionStatus"></div>
  <div id="worldStatus"></div>
  <div id="prompt"></div>
  <div id="inventory"></div>
</div>
<div id="npcPanel" class="panel compact"></div>
<div id="evolutionPanel" class="panel evolution hidden"></div>
<div id="log" class="panel log"></div>
<div id="admin" class="panel admin hidden">
  <div class="panel-title">${i18n.t('console.title')} <span>${i18n.t('console.close')}</span></div>
  <div id="adminStatus"></div>
  <div class="admin-section" id="jevBudgetPanel">
    <div class="admin-section-title">${i18n.t('budget.title')}</div>
    <div class="budget-grid">
      <label>calls/min <input id="budgetCallsMin" type="number" min="0" step="1" /></label>
      <label>tokens/min <input id="budgetTokensMin" type="number" min="0" step="1000" /></label>
      <label>tokens/hour <input id="budgetTokensHour" type="number" min="0" step="10000" /></label>
      <label>tokens/day <input id="budgetTokensDay" type="number" min="0" step="10000" /></label>
      <label>USD/day <input id="budgetUsdDay" type="number" min="0" step="0.01" /></label>
      <label>min confidence <input id="budgetConfidence" type="number" min="0" max="1" step="0.05" /></label>
      <label>cache ms <input id="budgetCacheTtl" type="number" min="0" step="250" /></label>
    </div>
    <div class="row budget-presets">
      <button data-budget-preset="economy">${i18n.t('budget.economy')}</button>
      <button data-budget-preset="balanced">${i18n.t('budget.balanced')}</button>
      <button data-budget-preset="quality">${i18n.t('budget.quality')}</button>
      <button id="budgetApplyBtn">${i18n.t('budget.apply')}</button>
    </div>
    <div id="budgetLive" class="small"></div>
  </div>
  <label>${i18n.t('console.importFormat')}
    <select id="importFormat"><option value="plain">${i18n.t('console.plain')}</option><option value="jsonl">${i18n.t('console.jsonl')}</option><option value="json">${i18n.t('console.json')}</option></select>
  </label>
  <input id="importFile" type="file" accept=".txt,.json,.jsonl,.csv" />
  <textarea id="importText" placeholder="每行一条完整台词；或：\nline<TAB>greet,happy<TAB>你好。\nfragment:opener<TAB>greet<TAB>嘿，"></textarea>
  <div class="row"><button id="importBtn">${i18n.t('console.import')}</button><button id="pauseBtn">${i18n.t('console.pause')}</button></div>
  <div class="small">${i18n.t('controls.first')}<br>${i18n.t('controls.god')}</div>
</div>
<div id="startOverlay">
  <div class="start-card">
    <h1>${i18n.t('start.title')}</h1>
    <p>${i18n.t('start.desc')}</p>
    <button id="startBtn">${i18n.t('start.enter')}</button>
    <div>${i18n.t('start.controls')}</div>
  </div>
</div>
<div id="speechLayer"></div>
<div id="toast"></div>
<div id="interactionMenu" class="panel interaction-menu hidden">
  <div class="interaction-head"><b id="interactionTitle"></b><button id="interactionClose">×</button></div>
  <div id="interactionActions" class="interaction-actions"></div>
  <div id="interactionMeta" class="interaction-meta"></div>
</div>`;

const ui = {
  clock: document.querySelector<HTMLDivElement>('#clock')!,
  decision: document.querySelector<HTMLDivElement>('#decisionStatus')!,
  world: document.querySelector<HTMLDivElement>('#worldStatus')!,
  prompt: document.querySelector<HTMLDivElement>('#prompt')!,
  inv: document.querySelector<HTMLDivElement>('#inventory')!,
  npc: document.querySelector<HTMLDivElement>('#npcPanel')!,
  evolution: document.querySelector<HTMLDivElement>('#evolutionPanel')!,
  log: document.querySelector<HTMLDivElement>('#log')!,
  admin: document.querySelector<HTMLDivElement>('#admin')!,
  adminStatus: document.querySelector<HTMLDivElement>('#adminStatus')!,
  budgetLive: document.querySelector<HTMLDivElement>('#budgetLive')!,
  toast: document.querySelector<HTMLDivElement>('#toast')!,
  speechLayer: document.querySelector<HTMLDivElement>('#speechLayer')!,
  modeBtn: document.querySelector<HTMLButtonElement>('#modeBtn')!,
  modeHint: document.querySelector<HTMLSpanElement>('#modeHint')!,
  crosshair: document.querySelector<HTMLDivElement>('#crosshair')!,
  overlay: document.querySelector<HTMLDivElement>('#startOverlay')!,
  interaction: document.querySelector<HTMLDivElement>('#interactionMenu')!,
  interactionTitle: document.querySelector<HTMLDivElement>('#interactionTitle')!,
  interactionActions: document.querySelector<HTMLDivElement>('#interactionActions')!,
  interactionMeta: document.querySelector<HTMLDivElement>('#interactionMeta')!,
  localeSelect: document.querySelector<HTMLSelectElement>('#localeSelect')!,
};

interface RuntimeObject { state: WorldObjectState; mesh: THREE.Object3D; }
interface AssetTemplate { scene: THREE.Object3D; animations: THREE.AnimationClip[]; }
interface VisualTarget {
  group: THREE.Group;
  asset: string;
  height: number;
  rotationY?: number;
  offsetZ?: number;
  targetWidth?: number;
  targetDepth?: number;
  fit?: 'uniform'|'exactBounds';
  resolvedSize?: {x:number;y:number;z:number};
  onResolved?: (model:THREE.Object3D)=>void;
}
interface ActionTask { approach?: NpcWorkApproach; action: DecisionAction; targetNpcId?: string; targetObjectId?: string; intent?: SocialIntent; startedAt:number; }
interface FineMetrics { food:number; wood:number; ecology:number; prosperity:number; shrub:number; fruit:number; crop:number; }
interface FineChunkRuntime {
  chunkId:string;
  npcIds:string[];
  objectIds:string[];
  wildlifeIds:string[];
  initialWildlifeCounts:Partial<Record<WildlifeSpecies,number>>;
  initialWildlifeIds:Set<string>;
  fixedWildlifeWeights:Map<string,number>;
  groups:THREE.Object3D[];
  initialMetrics:FineMetrics;
}
interface FineChunkCache {
  npcStates:NpcState[];
  objectStates:WorldObjectState[];
  wildlifeStates:WildlifeState[];
}
interface WildlifeRuntime {
  state: WildlifeState;
  mesh: THREE.Group;
  path: Vec2[];
  pathIndex: number;
  /** Fine-runtime momentum only; coarse/unloaded simulation does not persist frame velocity. */
  controllerSpeed: number;
  nextDecisionAt: number;
  actionResolved: boolean;
  removed?: boolean;
}
interface NpcRuntime {
  state: NpcState;
  characterAsset: string;
  mesh: THREE.Group;
  path: Vec2[];
  pathIndex: number;
  task?: ActionTask;
  nextDecisionAt: number;
  pendingDecision: boolean;
  speech?: { text:string; until:number };
  speechEl: HTMLDivElement;
  nameEl: HTMLDivElement;
  lastDecision?: DecisionResponse;
  mixer?: THREE.AnimationMixer;
  actions?: Map<string, THREE.AnimationAction>;
  activeAnimation?: string;
  activityAnimation?: string;
  activityAnimationUntil?: number;
  soles?: CharacterSoles;
  yieldPlan?: NpcYieldPlan;
  removed?: boolean;
}

class TownGame {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, innerWidth/innerHeight, .05, 180);
  renderer = new THREE.WebGLRenderer({antialias:true});
  controls: PointerLockControls;
  orbit: OrbitControls;
  clock = new THREE.Clock();
  sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sunShadow = new SunShadowView(this.sun);
  shadowFocus = new THREE.Vector3();
  ambient = new THREE.HemisphereLight(0xbfe8ff, 0x557044, 1.25);
  physics = new FinePhysicsAuthority();
  npcs = new Map<string,NpcRuntime>();
  objects = new Map<string,RuntimeObject>();
  wildlife = new Map<string,WildlifeRuntime>();
  wildlifePresentation = new WildlifePresentation(new WildlifeVisualRuntime());
  wildlifeLineage = new Map<string,WildlifeLineageRecord>();
  wildlifeTransfers = new Map<string,PersistedWildlifeTransfer>();
  lineageEpoch = 0;
  evolutionCacheEpoch = -1;
  evolutionCacheDay = -1;
  evolutionCache: WildlifeEvolutionStats[] = [];
  coevolutionCacheEpoch = -1;
  coevolutionCacheDay = -1;
  coevolutionCache: WildlifeCoevolutionPairEvidence[] = [];
  interactionSelectionCacheEpoch = -1;
  interactionSelectionCacheDay = -1;
  interactionSelectionCache: WildlifeReciprocalInteractionSelectionEvidence[] = [];
  interactionNetworkCacheAt = 0;
  interactionNetworkCache?: WildlifeInteractionNetwork;
  raycaster = new THREE.Raycaster();
  keys = new Set<string>();
  playerInventory: Record<ItemKind,number> = {apple:0,bread:1,wood:0,coin:10,flower:0,grain:0,flour:0,water:0,stone:0,plank:0,tool:0};
  minuteOfDay = 8*60 + 15;
  day = 1;
  weather = 'clear';
  weatherEpoch = 0;
  recentEvents: string[] = [];
  logs: string[] = [];
  aiPaused = false;
  inFlight = 0;
  maxInFlight = 3;
  hoverEntity?: {type:'npc'|'object'|'wildlife'; id:string};
  selectedEntity?: {type:'npc'|'object'|'wildlife'; id:string};
  cameraMode: 'firstPerson'|'god' = 'firstPerson';
  perceptionEpoch = 0;
  playerPosition: Vec2 = {x:0,z:7};
  playerTravel?: Vec2;
  playerBlockedNpcs = new Set<string>();
  firstPersonRotation = new THREE.Euler(0,0,0,'YXZ');
  godPointer = new THREE.Vector2(0,0);
  pointerDown?: {x:number;y:number};
  // The player is a world participant only in first-person mode. God mode is an out-of-world observer.
  selectionRing = new THREE.Mesh(
    new THREE.RingGeometry(.72,.92,32),
    new THREE.MeshBasicMaterial({color:0xfff176,transparent:true,opacity:.9,side:THREE.DoubleSide,depthWrite:false})
  );
  pathLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({color:0xfff176,transparent:true,opacity:.8})
  );
  lastHealthPoll = 0;
  decisionProvider = 'fallback';
  decisionCalls = 0;
  gltfLoader = new GLTFLoader();
  fbxLoader = new FBXLoader();
  assets = new Map<string,AssetTemplate>();
  visualTargets: VisualTarget[] = [];
  assetRoot = '/assets/quaternius';
  assetsReady = false;
  assetLoadFailures:string[] = [];
  coarseWorld!: CoarseWorldRuntime;
  interactionOpen = false;
  interactionObjectId?: string;
  interactionWildlifeId?: string;
  locale = i18n.locale;
  activeFineChunkId?: string;
  materializedChunks = new Map<string,FineChunkRuntime>();
  fineChunkCache = new Map<string,FineChunkCache>();
  persistenceReady = false;
  persistenceSaveInFlight = false;
  persistenceSaveQueued = false;
  persistenceRevision = 0;
  persistenceConflict = false;
  lastPersistenceSaveAt = 0;
  wildlifeDecisionPending = false;
  nextWildlifeBatchAt = 0;
  movableDirty = false;
  movableSaveTimer?: number;
  movableSaveRetryMs = 1500;
  readonly portables = new PortableObjectRuntime(this);

  constructor() {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.setSize(innerWidth,innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    document.querySelector('#game')!.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x91c9ef);
    this.scene.fog = new THREE.Fog(0x91c9ef, 48, 118);
    this.camera.position.set(0,1.7,7);
    this.controls = new PointerLockControls(this.camera, this.renderer.domElement);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enabled = false;
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = .08;
    this.orbit.screenSpacePanning = false;
    this.orbit.minDistance = 7;
    this.orbit.maxDistance = 96;
    this.orbit.maxPolarAngle = Math.PI * .49;
    this.orbit.minPolarAngle = Math.PI * .08;
    this.orbit.target.set(0,0,0);
    this.scene.add(this.camera, this.ambient, this.sun);
    this.coarseWorld = new CoarseWorldRuntime(this.scene);
    this.coarseWorld.setPresentationBridge({
      attach:(group,spec)=>{
        this.visualTargets=this.visualTargets.filter(target=>target.group!==group);
        this.attachVisualTarget({group,asset:spec.asset,height:spec.height,rotationY:spec.rotationY});
      },
      detach:group=>{
        this.visualTargets=this.visualTargets.filter(target=>target.group!==group);
        group.clear();
      }
    });
    this.scene.add(this.sun.target);
    this.setupWorld();
    this.setupSelectionOverlays();
    this.setupNpcs();
    void this.loadVisualAssets();
    this.bindInput();
    window.addEventListener('beforeunload',()=>this.flushWorldBeacon());
    this.refreshHealth();
    void this.initializePersistence();
    this.log('Latticefolk 已启动；未配置远程决策引擎时使用本地规则 provider。');
    this.animate();
  }

  setupWorld() {
    registerHomeTerrain(this.physics,WORLD_SIZE);
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(WORLD_SIZE, .25, WORLD_SIZE),
      new THREE.MeshStandardMaterial({color:0x74a95d, roughness:1})
    );
    ground.position.y = -.125; ground.receiveShadow = true; this.scene.add(ground);

    const roadMat = new THREE.MeshStandardMaterial({color:0xc3aa7d,roughness:1});
    const addRoad=(x:number,z:number,w:number,d:number)=>{
      const road=new THREE.Mesh(new THREE.BoxGeometry(w,.035,d),roadMat);
      road.position.set(x,.02,z);road.receiveShadow=true;this.scene.add(road);
    };
    addRoad(0,0,4,WORLD_SIZE-4);
    addRoad(0,0,WORLD_SIZE-4,4);
    addRoad(0,-18,WORLD_SIZE-12,2.4);
    addRoad(0,18,WORLD_SIZE-12,2.4);
    addRoad(-18,0,2.4,WORLD_SIZE-12);
    addRoad(18,0,2.4,WORLD_SIZE-12);

    this.addBuilding('农舍',-22,-18,9,8,0x9d744f,'houseA',8.4,.08);
    this.addBuilding('面包房',-10,-18,10,9,0xd58c55,'houseB',6.2,-.08);
    this.addBuilding('杂货市场',8,-18,10,8,0x79a3a8,'marketBuilding',5.4,0);
    this.addBuilding('旅店',21,-22,10,9,0xb28c75,'houseB',6.4,Math.PI);
    this.addBuilding('工坊',-22,12,10,8,0x7f8796,'storageBuilding',5.2,.08);
    this.addBuilding('守卫所',20,12,10,8,0x8a7868,'barracksBuilding',7.0,-.08);
    this.addBuilding('民居',8,14,9,8,0xb28c75,'houseA',8.2,Math.PI);
    this.addBuilding('北侧民居',-6,16,10,9,0xa77c61,'houseB',6.2,Math.PI);
    this.addBuilding('议事厅',0,27,12,10,0x8b7b68,'townCenter',8.5,Math.PI);
    this.addBuilding('仓库',23,-8,10,8,0x8a795d,'storageBuilding',5.2,Math.PI/2);
    this.addBuilding('风车',-28,27,10,10,0x9a805f,'windmill',10.0,.1);
    this.addBuilding('农场主屋',-28,-2,11,10,0x96704f,'farmBuilding',8.0,Math.PI/2);

    this.addObject({id:'well',kind:'well',name:'中央水井',position:{x:0,z:0},tags:['water','town','social'],usable:true,pickupable:false});
    this.addObject({id:'bench_w',kind:'bench',name:'西侧长椅',position:{x:-4,z:3},tags:['rest','social'],usable:true,pickupable:false});
    this.addObject({id:'bench_e',kind:'bench',name:'东侧长椅',position:{x:4,z:-3},tags:['rest','social'],usable:true,pickupable:false});
    this.addObject({id:'farm_plot',kind:'farm_plot',name:'南侧农田',position:{x:-22,z:-10},tags:['work','farm','food'],usable:true,pickupable:false});
    this.addObject({id:'oven',kind:'workstation',name:'面包炉',position:{x:-10,z:-13},tags:['work','baker','bread'],usable:true,pickupable:false});
    this.addObject({id:'market',kind:'food_stall',name:'集市摊位',position:{x:8,z:-11},tags:['food','trade','market'],usable:true,pickupable:false,item:'bread'});
    this.addObject({id:'maker_table',kind:'workstation',name:'工坊工作台',position:{x:-20,z:7},tags:['work','maker','wood'],usable:true,pickupable:false});
    this.addObject({id:'guard_post',kind:'workstation',name:'守卫装备架',position:{x:20,z:7},tags:['work','guard','safety'],usable:true,pickupable:false});
    this.addObject({id:'bed_n',kind:'bed',name:'公共休息铺',position:{x:7,z:9},tags:['rest','sleep'],usable:true,pickupable:false});
    this.addAssetObject({id:'cart_town',kind:'cart',name:'镇内货运推车',position:{x:0,z:4.7},tags:['transport','storage','trade','movable'],usable:true,pickupable:false,rigidBodyArchetype:'cart',storage:[],capabilities:['inspect','load','unload']},'cart',1.35,Math.PI/2,2.0,2.0);
    this.addObject({id:'crate_wood',kind:'crate',name:'木料箱',position:{x:-15,z:7},tags:['wood','supply'],usable:false,pickupable:true,item:'wood'});
    this.addObject({id:'barrel_food',kind:'crate',name:'补给木桶',position:{x:12,z:-9},tags:['food','supply','market'],usable:false,pickupable:true,item:'apple'});
    this.addObject({id:'mine',kind:'workstation',name:'旧矿井',position:{x:29,z:25},tags:['work','resource','stone','mine'],usable:true,pickupable:false});
    this.addObject({id:'mill',kind:'workstation',name:'风车磨坊',position:{x:-27,z:20},tags:['work','farm','grain','mill'],usable:true,pickupable:false});
    this.addObject({id:'tree_apple_1',kind:'tree',name:'苹果树',position:{x:-8,z:-5},tags:['food','apple','nature'],usable:true,pickupable:false,item:'apple'});
    this.addObject({id:'tree_apple_2',kind:'tree',name:'苹果树',position:{x:14,z:1.5},tags:['food','apple','nature'],usable:true,pickupable:false,item:'apple'});
    this.addObject({id:'tree_apple_3',kind:'tree',name:'苹果树',position:{x:-18,z:23},tags:['food','apple','nature'],usable:true,pickupable:false,item:'apple'});

    for (const [x,z] of [
      [-32,6],[-31,12],[-30,-12],[-25,-29],[-14,30],[-7,-30],[14,30],[30,15],[31,4],
      [29,-14],[22,-30],[4,-31],[-14,-27],[-31,-24],[33,-4],[-3,33]
    ] as Array<[number,number]>) this.addTreeDecoration(x,z);
  }

  addBuilding(name:string,x:number,z:number,w:number,d:number,_color:number,asset?:string,height=6,rotationY=0,options?:{id?:string;chunkId?:string}) {
    // Buildings are semantic/physical entities first. The visible representation is exclusively
    // the sourced licensed asset; never construct a temporary wall/roof/door primitive fallback.
    const g = new THREE.Group();
    g.position.set(x,0,z); this.scene.add(g);
    if(asset)this.attachVisualTarget({group:g,asset,height,rotationY,targetWidth:w,targetDepth:d,fit:'exactBounds'});

    const profile=this.buildingInteractionProfile(name);
    const doorDistance=d/2+1.15;
    const interactionPosition={x:x+Math.sin(rotationY)*doorDistance,z:z+Math.cos(rotationY)*doorDistance};
    const object:WorldObjectState={
      id:options?.id||`building_${name}`,chunkId:options?.chunkId,kind:'building',name,position:interactionPosition,tags:profile.tags,
      usable:true,pickupable:false,capabilities:profile.capabilities,storage:profile.storage?[]:undefined
    };
    g.userData={entityType:'object',entityId:object.id};
    this.objects.set(object.id,{state:object,mesh:g});
    const cos=Math.abs(Math.cos(rotationY)),sin=Math.abs(Math.sin(rotationY));
    const halfX=(w*cos+d*sin)/2,halfZ=(w*sin+d*cos)/2;
    this.physics.registerStatic({
      id:`building:${object.id}`,
      minX:x-halfX,maxX:x+halfX,minZ:z-halfZ,maxZ:z+halfZ,
      chunkId:options?.chunkId
    });
    this.physics.registerTrigger({
      id:`object-trigger:${object.id}`,
      minX:interactionPosition.x-1.15,maxX:interactionPosition.x+1.15,
      minZ:interactionPosition.z-1.15,maxZ:interactionPosition.z+1.15,
      chunkId:options?.chunkId,tag:'interaction'
    });

    if(options?.chunkId)this.materializedChunks.get(options.chunkId)?.groups.push(g);
    return g;
  }

  buildingInteractionProfile(name:string):{tags:string[];capabilities:InteractionCapability[];storage?:boolean} {
    const base:InteractionCapability[]=['inspect','visit'];
    if(name.includes('面包'))return {tags:['building','baker','food','work','trade'],capabilities:[...base,'work','craft','buy','sell','trade']};
    if(name.includes('市场'))return {tags:['building','shopkeeper','market','trade'],capabilities:[...base,'buy','sell','trade']};
    if(name.includes('工坊'))return {tags:['building','maker','work','storage'],capabilities:[...base,'work','craft','store','take'],storage:true};
    if(name.includes('守卫'))return {tags:['building','guard','work','safety'],capabilities:[...base,'work']};
    if(name.includes('仓库'))return {tags:['building','storage','trade'],capabilities:[...base,'store','take','work'],storage:true};
    if(name.includes('风车'))return {tags:['building','mill','farm','work'],capabilities:[...base,'work','craft']};
    if(name.includes('农舍')||name.includes('农场'))return {tags:['building','home','farmer','farm','storage'],capabilities:[...base,'work','store','take'],storage:true};
    if(name.includes('旅店'))return {tags:['building','inn','rest','food'],capabilities:[...base,'rest','sleep','buy']};
    if(name.includes('议事'))return {tags:['building','civic','social'],capabilities:[...base]};
    return {tags:['building','home','social'],capabilities:base};
  }

  addTreeDecoration(x:number,z:number) {
    const g = new THREE.Group();
    // The sourced tree is the only visual, including while it is loading.
    g.position.set(x,0,z); this.scene.add(g);
    const variant = ['tree1','tree2','tree3'][Math.abs(Math.round(x*3+z*5))%3];
    this.attachVisualTarget({group:g,asset:variant,height:treeVisualHeight(variant),rotationY:(x+z)*.17,
      onResolved:model=>this.physics.registerStatic(treePhysics(model,`tree-decoration:${x}:${z}`,undefined,false).collider)
    });
  }

  addAssetObject(
    state:WorldObjectState,
    asset:string,
    assetHeight:number,
    rotationY=0,
    targetWidth?:number,
    targetDepth?:number,
    fit:VisualTarget['fit']='uniform',
    syncStaticCollider=false,
    offsetZ=0
  ) {
    const g=new THREE.Group();
    g.position.set(state.position.x,0,state.position.z);
    g.userData={entityType:'object',entityId:state.id};
    this.scene.add(g);
    state.capabilities=state.capabilities?.length?state.capabilities:this.defaultCapabilities(state);
    this.objects.set(state.id,{state,mesh:g});
    this.registerWorldObjectPhysics(state);
    this.attachVisualTarget({
      group:g,asset,height:assetHeight,rotationY,offsetZ,targetWidth,targetDepth,fit,
      onResolved:state.kind==='tree'?model=>{
        const physical=treePhysics(model,`object:${state.id}`,state.chunkId);
        this.physics.registerStatic(physical.collider);
        if(physical.trigger)this.physics.registerTrigger(physical.trigger);
        g.userData.treePhysics=physical;
      }:syncStaticCollider?()=>this.syncStaticObjectCollider(state,g):undefined
    });
    if(state.chunkId)this.materializedChunks.get(state.chunkId)?.groups.push(g);
    return g;
  }

  syncStaticObjectCollider(state:WorldObjectState,visual:THREE.Object3D) {
    if(state.pickupable||worldObjectRigidBody(state)||state.kind==='farm_plot'||state.kind==='water_patch')return;
    visual.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(visual);
    if(box.isEmpty())return;
    if(isBakingOven(state)){
      const bounds={minX:box.min.x,maxX:box.max.x,minZ:box.min.z,maxZ:box.max.z};
      const {collider,trigger}=bakingOvenPhysics(state,bounds);
      this.physics.registerStatic(collider);
      this.physics.registerTrigger(trigger);
      visual.userData.ovenPhysics={collider,trigger};
      return;
    }
    this.physics.registerStatic({
      id:`object:${state.id}`,
      minX:box.min.x,maxX:box.max.x,minZ:box.min.z,maxZ:box.max.z,
      chunkId:state.chunkId
    });
  }

  addFarmPlotObject(state:WorldObjectState) {
    const root=new THREE.Group();
    root.position.set(state.position.x,0,state.position.z);
    root.userData={entityType:'object',entityId:state.id};
    this.scene.add(root);
    state.capabilities=state.capabilities?.length?state.capabilities:this.defaultCapabilities(state);
    this.objects.set(state.id,{state,mesh:root});
    this.registerWorldObjectPhysics(state);

    const soil=new THREE.Group();
    root.add(soil);
    this.attachVisualTarget({
      group:soil,asset:'farmSoil',height:.12,targetWidth:4,targetDepth:2.7,fit:'exactBounds'
    });
    const rows=[-1.25,-.42,.42,1.25];
    for(const x of rows)for(const z of [-.72,0,.72]){
      const crop=new THREE.Group();
      crop.position.set(x,.12,z); // The sourced soil's top, not four centimetres below it.
      root.add(crop);
      this.attachVisualTarget({group:crop,asset:'farmWheat',height:.72});
    }
    if(state.chunkId)this.materializedChunks.get(state.chunkId)?.groups.push(root);
    return root;
  }

  semanticAssetSpec(state:WorldObjectState):{
    asset:string;height:number;rotationY?:number;offsetZ?:number;width?:number;depth?:number;fit?:VisualTarget['fit'];syncStatic?:boolean
  }|undefined {
    if(state.kind==='bench')return {asset:'benchAsset',height:.82,width:2.0,depth:.70,fit:'exactBounds',syncStatic:true};
    if(state.kind==='bed')return {asset:'bedAsset',height:.78,rotationY:Math.PI/2,width:1.0,depth:2.0,fit:'exactBounds',syncStatic:true};
    if(state.kind==='food_stall')return {asset:'stallAsset',height:2.6,width:2.3,depth:1.2,fit:'exactBounds',syncStatic:true};
    if(state.kind==='workstation'){
      if(state.id==='mine'||state.tags.includes('mine'))return {asset:'mineAsset',height:4.5,rotationY:Math.PI};
      const oven=bakingOvenVisualSpec(state);
      if(oven)return oven;
      if(state.tags.includes('guard'))return {asset:'weaponStandAsset',height:1.25,width:1.4,depth:1.0,fit:'exactBounds',syncStatic:true};
      return {asset:'workbenchAsset',height:1.0,width:2.0,depth:1.0,fit:'exactBounds',syncStatic:true};
    }
    if(state.kind==='tree'){
      const asset=state.id.endsWith('2')?'tree3':'tree2';
      return {asset,height:treeVisualHeight(asset),rotationY:state.position.x*.13};
    }
    if(state.kind==='crate')return {asset:state.id==='barrel_food'?'barrel':'crate_rts',height:state.id==='barrel_food'?1.15:1.05,rotationY:Math.PI/2};
    return undefined;
  }

  addObject(state:WorldObjectState,assetOverride?:string,assetHeight?:number,rotationY=0) {
    const parcel=droppedParcelSpec(state);
    if(parcel)return this.addAssetObject(state,parcel.asset,parcel.height);
    const water=waterPatchVisualSpec(state);
    if(water){
      const group=this.addAssetObject(state,water.asset,water.height,0,water.width,water.depth,'exactBounds');
      group.position.y=water.surfaceY;
      return group;
    }
    if(state.kind==='farm_plot')return this.addFarmPlotObject(state);
    if(state.kind==='well'){
      return this.addAssetObject(
        state,
        assetOverride||'wellAsset',
        assetHeight||2.6,
        rotationY,
        2.0,
        2.0
      );
    }
    if(assetOverride)return this.addAssetObject(state,assetOverride,
      state.kind==='tree'?treeVisualHeight(assetOverride,assetHeight):assetHeight||2,rotationY);
    const semanticSpec=this.semanticAssetSpec(state);
    if(semanticSpec){
      return this.addAssetObject(
        state,semanticSpec.asset,semanticSpec.height,semanticSpec.rotationY??rotationY,
        semanticSpec.width,semanticSpec.depth,semanticSpec.fit,semanticSpec.syncStatic,semanticSpec.offsetZ
      );
    }
    throw new Error(`Missing sourced semantic visual: ${state.kind} (${state.id})`);
  }


  registerWorldObjectPhysics(state:WorldObjectState) {
    if(state.usable||state.pickupable||(state.capabilities?.length??0)>0){
      const triggerRadius=state.kind==='well'||state.kind==='food_stall'?1.45:1.15;
      this.physics.registerTrigger({
        id:`object-trigger:${state.id}`,
        minX:state.position.x-triggerRadius,maxX:state.position.x+triggerRadius,
        minZ:state.position.z-triggerRadius,maxZ:state.position.z+triggerRadius,
        chunkId:state.chunkId,tag:'interaction'
      });
    }

    const halfExtents:Partial<Record<WorldObjectState['kind'],[number,number]>>={
      well:[.70,1.0],
      bench:[1.0,.35],
      bed:[1.0,.50],
      food_stall:[1.15,.60],
      workstation:[1.0,.50],
      tree:[.34,.34],
      crate:[.38,.38],
      rock:[.44,.44],
      cart:[1.05,.52]
    };
    const extent=halfExtents[state.kind];
    if(!extent||(state.pickupable&&state.kind!=='tree')||worldObjectRigidBody(state))return;
    const [halfX,halfZ]=extent;
    this.physics.registerStatic({
      id:`object:${state.id}`,
      minX:state.position.x-halfX,maxX:state.position.x+halfX,
      minZ:state.position.z-halfZ,maxZ:state.position.z+halfZ,
      chunkId:state.chunkId
    });
  }

  defaultCapabilities(state:WorldObjectState):InteractionCapability[] {
    switch(state.kind){
      case 'well': return ['inspect','draw_water','drink','wash'];
      case 'water_patch': return ['inspect','draw_water','drink','wash'];
      case 'bench': return ['inspect','sit','rest'];
      case 'bed': return ['inspect','rest','sleep'];
      case 'food_stall': return ['inspect','buy','sell','trade'];
      case 'farm_plot': return ['inspect','harvest','work'];
      case 'workstation': return ['inspect','work','craft'];
      case 'tree': return ['inspect','harvest','chop'];
      case 'crate': return ['inspect','store','take',...(state.pickupable?['pickup' as InteractionCapability]:[])];
      case 'bush': return ['inspect','forage'];
      case 'rock': return ['inspect','mine'];
      case 'flower': return ['inspect','harvest'];
      case 'cart': return ['inspect','load','unload'];
      case 'tool_prop': return ['inspect','pickup'];
      case 'building': return ['inspect','visit'];
      case 'road': return ['inspect'];
      case 'dropped_item': return ['inspect','pickup'];
      default: return ['inspect'];
    }
  }

  decorationState(asset:string,x:number,z:number):WorldObjectState {
    const id=`prop_${asset}_${String(x).replace('.','_')}_${String(z).replace('.','_')}`;
    if(asset==='bush')return {id,kind:'bush',name:'灌木丛',position:{x,z},tags:['nature','forage'],usable:true,pickupable:false,item:'flower',resourceAmount:3,capabilities:['inspect','forage']};
    if(asset==='rock')return {id,kind:'rock',name:'岩石',position:{x,z},tags:['nature','resource','stone'],usable:true,pickupable:false,item:'stone',resourceAmount:6,capabilities:['inspect','mine']};
    if(asset==='flowers')return {id,kind:'flower',name:'野花',position:{x,z},tags:['nature','flower'],usable:true,pickupable:false,item:'flower',resourceAmount:3,capabilities:['inspect','harvest']};
    if(asset==='cart')return {id,kind:'cart',name:'货运推车',position:{x,z},tags:['transport','storage','trade'],usable:true,pickupable:false,storage:[],capabilities:['inspect','load','unload']};
    if(asset==='axe')return {id,kind:'tool_prop',name:'木柄斧',position:{x,z},tags:['tool','wood'],usable:true,pickupable:true,item:'tool',capabilities:['inspect','pickup']};
    if(asset==='shovel')return {id,kind:'tool_prop',name:'木柄铲',position:{x,z},tags:['tool','farm'],usable:true,pickupable:true,item:'tool',capabilities:['inspect','pickup']};
    if(asset==='crate_rts')return {id,kind:'crate',name:'储物箱',position:{x,z},tags:['storage'],usable:true,pickupable:false,storage:[],capabilities:['inspect','store','take']};
    if(asset==='barrel')return {id,kind:'crate',name:'木桶',position:{x,z},tags:['storage','water'],usable:true,pickupable:false,storage:[],capabilities:['inspect','store','take']};
    return {id,kind:'dropped_item',name:asset,position:{x,z},tags:['prop'],usable:true,pickupable:false,capabilities:['inspect']};
  }


  setupSelectionOverlays() {
    // Selection/path overlays are not player entities or formal scene models.
    this.selectionRing.rotation.x=-Math.PI/2;this.selectionRing.position.y=.035;this.selectionRing.visible=false;this.scene.add(this.selectionRing);
    this.pathLine.visible=false;this.pathLine.frustumCulled=false;this.scene.add(this.pathLine);
  }

  setupNpcs() {
    const seed: Array<[string,string,NpcRole,number,number,string|undefined,Mood]> = [
      ['mina','米娜','farmer',-20,-9,'farm_plot','calm'],
      ['ren','莲','baker',-9,-11,'oven','happy'],
      ['sora','空','shopkeeper',7,-10,'market','neutral'],
      ['kai','凯','guard',18,6,'guard_post','calm'],
      ['yui','结衣','maker',-18,6,'maker_table','curious'],
      ['nao','直','resident',6,8,undefined,'neutral'],
      ['haru','春','farmer',-26,5,'mill','happy'],
      ['mei','芽衣','resident',-4,9,undefined,'curious'],
      ['toma','冬马','guard',22,3,'guard_post','neutral'],
      ['aki','秋','shopkeeper',14,-7,'market','calm'],
    ];
    for (const [id,name,role,x,z,workAt,mood] of seed) {
      const state: NpcState = {
        id,name,role,position:{x,z},home:{x:x<0?x-3:x+3,z:z<0?z-6:z+6},workAt,mood,
        hunger:25+Math.random()*25,energy:65+Math.random()*25,social:45+Math.random()*30,money:8+Math.floor(Math.random()*12),
        inventory:
          role==='baker'?[{kind:'bread',count:2},{kind:'flour',count:1},{kind:'water',count:1}]:
          role==='farmer'?[{kind:'apple',count:1},{kind:'grain',count:2}]:
          role==='maker'?[{kind:'wood',count:2},{kind:'stone',count:1}]:
          role==='shopkeeper'?[{kind:'bread',count:2},{kind:'apple',count:2}]:
          role==='guard'?[{kind:'bread',count:1}]:[],
        relationships:{},memories:[],currentAction:'idle',goal:'过好今天并照顾自己的需要',lastDecisionAt:0
      };
      const mesh=new THREE.Group(); mesh.position.set(x,this.groundHeightAt(x,z),z); mesh.userData={entityType:'npc',entityId:id}; this.scene.add(mesh);
      const characterAsset:Record<string,string>={mina:'female1',ren:'female2',sora:'male1',kai:'male2',yui:'female1',nao:'male1',haru:'male2',mei:'female2',toma:'male1',aki:'female1'};
      // Cube World characters already face the local +Z direction used by moveNpc.
      this.attachVisualTarget({group:mesh,asset:characterAsset[id],height:1.82,rotationY:0});
      const speechEl=document.createElement('div'); speechEl.className='speech hidden'; ui.speechLayer.appendChild(speechEl);
      const nameEl=document.createElement('div'); nameEl.className='npc-name hidden'; ui.speechLayer.appendChild(nameEl);
      this.npcs.set(id,{state,characterAsset:characterAsset[id],mesh,path:[],pathIndex:0,nextDecisionAt:now()+1000+Math.random()*5000,pendingDecision:false,speechEl,nameEl});
    }
    for(const a of this.npcs.values()) {
      for(const b of this.npcs.values()) if(a!==b) a.state.relationships[b.state.id]={affinity:45+Math.round(Math.random()*20),trust:45+Math.round(Math.random()*20),familiarity:25+Math.round(Math.random()*35)};
      a.state.relationships.player={affinity:50,trust:50,familiarity:5};
    }
  }

  async loadVisualAssets() {
    const defs: Record<string,string> = {
      female1:'cube-world/Character_Female_1.gltf', female2:'cube-world/Character_Female_2.gltf',
      male1:'cube-world/Character_Male_1.gltf', male2:'cube-world/Character_Male_2.gltf',
      tree1:'cube-world/Tree_1.gltf', tree2:'cube-world/Tree_2.gltf', tree3:'cube-world/Tree_3.gltf',
      bush:'cube-world/Bush.gltf', rock:'cube-world/Rock2.gltf', flowers:'cube-world/Flowers_1.gltf',
      chest:'cube-world/Chest_Closed.gltf', cart:'cube-world/Cart.gltf', axe:'cube-world/Axe_Wood.gltf', shovel:'cube-world/Shovel_Wood.gltf',
      houseA:'ultimate-fantasy-rts/Houses_SecondAge_1_Level3.gltf',
      houseB:'ultimate-fantasy-rts/Houses_SecondAge_2_Level3.gltf',
      marketBuilding:'ultimate-fantasy-rts/Market_FirstAge_Level3.gltf',
      barracksBuilding:'ultimate-fantasy-rts/Barracks_FirstAge_Level3.gltf',
      storageBuilding:'ultimate-fantasy-rts/Storage_FirstAge_Leve3.gltf',
      townCenter:'ultimate-fantasy-rts/TownCenter_FirstAge_Level3.gltf',
      windmill:'ultimate-fantasy-rts/Windmill_FirstAge.gltf',
      farmBuilding:'ultimate-fantasy-rts/Farm_SecondAge_Level3.gltf',
      crate_rts:'ultimate-fantasy-rts/Crate.gltf',
      barrel:'ultimate-fantasy-rts/Barrel.gltf',
      mineAsset:'ultimate-fantasy-rts/Mine.gltf',
      wellAsset:'medieval-village/Well.fbx',
      benchAsset:'fantasy-props-standard/Bench.gltf',
      bedAsset:'fantasy-props-standard/Bed_Twin1.gltf',
      stallAsset:'fantasy-props-standard/Stall_Empty.gltf',
      workbenchAsset:'fantasy-props-standard/Workbench.gltf',
      weaponStandAsset:'fantasy-props-standard/WeaponStand.gltf',
      farmSoil:'/assets/kenney/nature/crops_dirtDoubleRow.glb',
      farmWheat:'/assets/kenney/nature/crops_wheatStageB.glb',
      [WATER_PATCH_ASSET]:'/assets/kenney/nature/ground_riverOpen.glb',
      [BAKING_OVEN_ASSET]:'/assets/firefly-in-the-dusk/cast-iron-stove/CastIronStove.gltf'
    };
    const assetEntries=Object.entries(defs);
    const loaded = await Promise.allSettled(assetEntries.map(async ([key,file])=>{
      const assetUrl=file.startsWith('/')?file:`${this.assetRoot}/${file}`;
      if(file.toLowerCase().endsWith('.fbx')){
        const scene=await this.fbxLoader.loadAsync(assetUrl);
        this.assets.set(key,{scene,animations:scene.animations||[]});
      }else{
        const gltf=await this.gltfLoader.loadAsync(assetUrl);
        this.assets.set(key,{scene:gltf.scene,animations:gltf.animations});
      }
    }));
    this.assetLoadFailures=loaded.flatMap((result,index)=>result.status==='rejected'?[assetEntries[index]![0]]:[]);
    for(const target of this.visualTargets)this.applyVisualTarget(target);
    this.spawnAssetDecoration('bush',-16,1,1.0,.2);
    this.spawnAssetDecoration('bush',16,-2,1.0,1.7);
    this.spawnAssetDecoration('bush',-5,23,1.0,.7);
    this.spawnAssetDecoration('rock',31,8,.8,.6);
    this.spawnAssetDecoration('rock',-30,-8,.65,2.2);
    this.spawnAssetDecoration('flowers',-4,-7,.85,.4);
    this.spawnAssetDecoration('flowers',5,4,.8,2.3);
    this.spawnAssetDecoration('axe',-20.8,6.5,.9,-.4);
    this.spawnAssetDecoration('shovel',-22.8,-10.7,.9,.5);
    this.spawnAssetDecoration('crate_rts',23,-3,1.1,.3);
    this.spawnAssetDecoration('barrel',10,-8.8,1.15,0);
    this.spawnAssetDecoration('barrel',11,-8.5,1.15,.4);
    this.assetsReady=this.assetLoadFailures.length===0;
    this.log(`视觉素材：Quaternius 已加载 ${assetEntries.length-this.assetLoadFailures.length}/${assetEntries.length}（Cube World + Ultimate Fantasy RTS + Medieval Village）`);
    if(this.assetLoadFailures.length)this.log(`素材加载失败：${this.assetLoadFailures.join(', ')}；对应对象保持不可见（禁止程序化 fallback）。`);
  }

  attachVisualTarget(target:VisualTarget) {
    // Asset-backed entities must never expose assistant-authored primitive geometry as a visible loading/error fallback.
    // The semantic group and authoritative physics remain alive while the licensed visual is pending or unavailable.
    target.group.clear();
    this.visualTargets.push(target);
    if(this.assets.has(target.asset))this.applyVisualTarget(target);
  }

  applyVisualTarget(target:VisualTarget) {
    const tpl=this.assets.get(target.asset);if(!tpl)return;
    const isCharacter=target.asset.startsWith('female')||target.asset.startsWith('male');
    const model=(isCharacter?cloneSkeleton(tpl.scene):tpl.scene.clone(true)) as THREE.Object3D;
    const isTree=/^tree[123]$/.test(target.asset);
    target.resolvedSize=isTree?fitTreeModel(model,target.height,target.rotationY||0)
      :this.normalizeModel(model,target.height,target.targetWidth,target.targetDepth,target.fit==='exactBounds');
    if(!isTree)model.rotation.y=target.rotationY||0;
    model.position.z+=target.offsetZ??0;
    target.group.clear();
    target.group.add(model);
    target.onResolved?.(model);
    if(isCharacter){
      const agent=[...this.npcs.values()].find(n=>n.mesh===target.group);
      if(agent&&tpl.animations.length){
        agent.soles=new CharacterSoles(model);
        agent.mixer=new THREE.AnimationMixer(model);
        agent.actions=new Map(tpl.animations.map(clip=>[clip.name,agent.mixer!.clipAction(clip)]));
        this.setNpcAnimation(agent,'Idle');
        agent.mixer.update(0);
        this.alignNpcVisualToGround(agent);
      }
    }
  }

  normalizeModel(model:THREE.Object3D,targetHeight:number,targetWidth?:number,targetDepth?:number,exactBounds=false) {
    model.traverse(o=>{if((o as THREE.Mesh).isMesh){const m=o as THREE.Mesh;m.castShadow=true;m.receiveShadow=true;}});
    model.updateMatrixWorld(true);
    let box=new THREE.Box3().setFromObject(model);const size=new THREE.Vector3();box.getSize(size);
    if(exactBounds&&targetWidth&&targetDepth&&size.x>0&&size.z>0){
      // Flat sourced surfaces (for example the Kenney water tile) still need an exact
      // X/Z footprint even though their authored Y extent is zero. Never invent thickness.
      model.scale.x*=targetWidth/size.x;
      if(size.y>0)model.scale.y*=targetHeight/size.y;
      model.scale.z*=targetDepth/size.z;
    }else if(size.y>0){
      let scale=targetHeight/size.y;
      if(targetWidth&&targetDepth&&size.x>0&&size.z>0){
        const footprintScale=Math.min(targetWidth/size.x,targetDepth/size.z);
        scale=Math.min(footprintScale,targetHeight/size.y);
      }
      model.scale.multiplyScalar(scale);
    }
    model.updateMatrixWorld(true);box=new THREE.Box3().setFromObject(model);
    const center=new THREE.Vector3();box.getCenter(center);
    model.position.x-=center.x;
    model.position.z-=center.z;
    model.position.y-=box.min.y;
    model.updateMatrixWorld(true);
    box=new THREE.Box3().setFromObject(model);
    const resolved=new THREE.Vector3();box.getSize(resolved);
    return {x:resolved.x,y:resolved.y,z:resolved.z};
  }

  spawnAssetDecoration(asset:string,x:number,z:number,height:number,rotationY=0) {
    const tpl=this.assets.get(asset);if(!tpl)return;
    const model=tpl.scene.clone(true);this.normalizeModel(model,height);model.rotation.y=rotationY;model.position.x=x;model.position.z=z;
    const state=this.decorationState(asset,x,z);
    model.userData={entityType:'object',entityId:state.id};
    this.scene.add(model);
    this.objects.set(state.id,{state,mesh:model});
    this.registerWorldObjectPhysics(state);
  }

  setNpcAnimation(agent:NpcRuntime,name:string) {
    if(!agent.actions||agent.activeAnimation===name)return;
    const next=agent.actions.get(name)||agent.actions.get('Idle');if(!next)return;
    const previous=agent.activeAnimation?agent.actions.get(agent.activeAnimation):undefined;
    previous?.fadeOut(.18);next.reset().fadeIn(.18).play();agent.activeAnimation=name;
  }

  bindInput() {
    addEventListener('resize',()=>{ this.camera.aspect=innerWidth/innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth,innerHeight); });
    addEventListener('keydown',(e)=>{
      const tag=(e.target as HTMLElement | null)?.tagName;
      if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;
      if(e.code==='Escape'&&this.interactionOpen){e.preventDefault();this.closeInteractionMenu(true);return;}
      if (e.code==='Tab') { e.preventDefault(); ui.admin.classList.toggle('hidden'); return; }
      if (e.code==='KeyG') { e.preventDefault(); this.toggleCameraMode(); return; }
      if (e.code==='KeyF' && this.cameraMode==='god') { this.focusSelected(); return; }
      if (e.code==='Space' && this.cameraMode==='god') { e.preventDefault(); this.focusTown(); return; }
      if (e.code==='KeyE' && this.cameraMode==='firstPerson') { this.interact(); return; }
      this.keys.add(e.code);
    });
    addEventListener('keyup',(e)=>this.keys.delete(e.code));
    document.querySelector('#startBtn')!.addEventListener('click',()=>{this.cameraMode='firstPerson';this.controls.lock();});
    ui.modeBtn.addEventListener('click',()=>this.toggleCameraMode());
    this.controls.addEventListener('lock',()=>ui.overlay.classList.add('hidden'));
    this.controls.addEventListener('unlock',()=>{if(this.cameraMode==='firstPerson'&&!this.interactionOpen)ui.overlay.classList.remove('hidden');});
    document.querySelector('#interactionClose')!.addEventListener('click',()=>this.closeInteractionMenu(true));
    ui.localeSelect.addEventListener('change',()=>{localStorage.setItem('latticefolk.locale',ui.localeSelect.value);location.reload();});
    document.querySelector('#budgetApplyBtn')!.addEventListener('click',()=>this.applyBudgetFromUi());
    document.querySelectorAll<HTMLButtonElement>('[data-budget-preset]').forEach(btn=>btn.addEventListener('click',()=>this.applyBudgetPreset(btn.dataset.budgetPreset||'balanced')));

    this.renderer.domElement.addEventListener('pointermove',(e)=>{
      const rect=this.renderer.domElement.getBoundingClientRect();
      this.godPointer.set(((e.clientX-rect.left)/rect.width)*2-1,-((e.clientY-rect.top)/rect.height)*2+1);
      if(this.pointerDown&&Math.hypot(e.clientX-this.pointerDown.x,e.clientY-this.pointerDown.y)>7)this.pointerDown=undefined;
    });
    this.renderer.domElement.addEventListener('pointerdown',(e)=>{if(this.cameraMode==='god'&&e.button===0){const rect=this.renderer.domElement.getBoundingClientRect();this.godPointer.set(((e.clientX-rect.left)/rect.width)*2-1,-((e.clientY-rect.top)/rect.height)*2+1);this.pointerDown={x:e.clientX,y:e.clientY};}});
    this.renderer.domElement.addEventListener('pointerup',(e)=>{
      if(this.cameraMode!=='god'||e.button!==0||!this.pointerDown)return;
      const d=Math.hypot(e.clientX-this.pointerDown.x,e.clientY-this.pointerDown.y);this.pointerDown=undefined;
      if(d<=7)this.selectGodEntity();
    });
    this.renderer.domElement.addEventListener('dblclick',(e)=>{if(this.cameraMode==='god'&&e.button===0){this.selectGodEntity();this.focusSelected();}});

    document.querySelector('#pauseBtn')!.addEventListener('click',()=>{
      this.aiPaused=!this.aiPaused; (document.querySelector('#pauseBtn') as HTMLButtonElement).textContent=this.aiPaused?i18n.t('console.resume'):i18n.t('console.pause');
      this.toast(this.aiPaused?'NPC AI 已暂停':'NPC AI 已恢复');
    });
    const file=document.querySelector<HTMLInputElement>('#importFile')!;
    file.addEventListener('change',async()=>{ if(file.files?.[0]) (document.querySelector<HTMLTextAreaElement>('#importText')!).value=await file.files[0].text(); });
    document.querySelector('#importBtn')!.addEventListener('click',()=>this.importDialogue());
  }

  toggleCameraMode() {
    if(this.cameraMode==='firstPerson')this.enterGodMode();else this.enterFirstPerson();
  }

  enterGodMode() {
    if(this.cameraMode==='god')return;
    this.playerPosition={x:this.camera.position.x,z:this.camera.position.z};
    this.firstPersonRotation.copy(this.camera.rotation);
    this.cameraMode='god';
    this.perceptionEpoch++;
    if(this.controls.isLocked)this.controls.unlock();
    ui.overlay.classList.add('hidden');
    this.orbit.enabled=true;
    this.orbit.target.set(this.playerPosition.x,0,this.playerPosition.z);
    this.camera.position.set(this.playerPosition.x+12,18,this.playerPosition.z+12);
    this.camera.lookAt(this.orbit.target);
    this.orbit.update();
    // God mode is observer-only: no player entity is exposed to NPC perception or targeting.
    this.cancelPlayerTargeting();
    this.suspendPlayerWildlifeFollowPaths();
    ui.crosshair.classList.add('hidden');
    ui.modeBtn.textContent=i18n.t('mode.first');ui.modeHint.textContent=i18n.t('mode.observer');
    this.toast('上帝视角：玩家已从 NPC 感知中移除 · 点击查看 · 双击/F 聚焦');
  }

  enterFirstPerson() {
    if(this.cameraMode==='firstPerson')return;
    this.cameraMode='firstPerson';
    this.perceptionEpoch++;
    this.orbit.enabled=false;
    this.camera.position.set(this.playerPosition.x,1.7,this.playerPosition.z);
    this.camera.rotation.copy(this.firstPersonRotation);
    ui.crosshair.classList.remove('hidden');
    ui.modeBtn.textContent=i18n.t('mode.god');ui.modeHint.textContent=i18n.t('mode.first');
    this.controls.lock();
  }


  cancelPlayerTargeting() {
    for(const agent of this.npcs.values()) {
      if(agent.task?.targetNpcId!=='player' && agent.state.targetNpcId!=='player') continue;
      agent.task=undefined;
      agent.path=[];
      agent.pathIndex=0;
      agent.state.currentAction='idle';
      agent.state.targetNpcId=undefined;
      agent.nextDecisionAt=now()+500+Math.random()*1000;
    }
  }

  suspendPlayerWildlifeFollowPaths() {
    for(const animal of this.wildlife.values()){
      const domestication=normalizeWildlifeDomestication(animal.state.species,animal.state.domestication);
      if(domestication?.ownerId!=='player'||domestication.command!=='follow')continue;
      animal.path=[];animal.pathIndex=0;animal.controllerSpeed=0;animal.actionResolved=true;
      animal.state.currentAction='rest';
      animal.state.targetObjectId=undefined;animal.state.targetWildlifeId=undefined;animal.state.targetChunkId=undefined;
    }
  }

  focusTown() {
    if(this.cameraMode!=='god')return;
    this.moveGodTarget(new THREE.Vector3(0,0,0),22);
  }

  focusSelected() {
    if(this.cameraMode!=='god'||!this.selectedEntity)return;
    const p=this.entityPosition(this.selectedEntity);if(!p)return;
    this.moveGodTarget(new THREE.Vector3(p.x,0,p.z),11);
  }

  moveGodTarget(target:THREE.Vector3,distance:number) {
    const dir=this.camera.position.clone().sub(this.orbit.target).normalize();
    this.orbit.target.copy(target);this.camera.position.copy(target).add(dir.multiplyScalar(distance));
    if(this.camera.position.y<5)this.camera.position.y=5;this.orbit.update();
  }

  selectGodEntity() {
    const entity=this.pickEntity(this.godPointer,Infinity);
    this.selectedEntity=entity;
    if(entity){const name=entity.type==='npc'?this.npcs.get(entity.id)?.state.name:entity.type==='wildlife'?this.wildlifeName(this.wildlife.get(entity.id)!.state.species):this.objects.get(entity.id)?.state.name;this.toast(`已选择：${name||entity.id}`);}
  }

  entityPosition(entity:{type:'npc'|'object'|'wildlife';id:string}):Vec2|undefined {
    return entity.type==='npc'?this.npcs.get(entity.id)?.state.position:entity.type==='wildlife'?this.wildlife.get(entity.id)?.state.position:this.objects.get(entity.id)?.state.position;
  }

  async importDialogue() {
    const format=(document.querySelector<HTMLSelectElement>('#importFormat')!).value;
    const text=(document.querySelector<HTMLTextAreaElement>('#importText')!).value;
    if(!text.trim()){this.toast(i18n.t('dialogue.import.empty'));return;}
    try{
      const r=await fetch('/api/dialogue/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({format,text,locale:this.locale})});
      const j=await r.json(); if(!r.ok) throw new Error(j.error||'import failed');
      this.toast(i18n.t('dialogue.import.done',{count:j.imported,total:j.total})); this.refreshHealth();
    }catch(e){this.toast(i18n.t('dialogue.import.failed',{error:e instanceof Error?e.message:String(e)}));}
  }

  animate = () => {
    requestAnimationFrame(this.animate);
    const dt=Math.min(.05,this.clock.getDelta());
    this.playerTravel=undefined;this.playerBlockedNpcs.clear();
    if(this.cameraMode==='firstPerson'){this.updatePlayer(dt);if(this.persistenceReady)this.updateFineChunkMaterialization();}else this.updateGodCamera(dt);
    if(this.persistenceReady){
      this.updateTime(dt);
      this.coarseWorld.update({day:this.day,gameTime:this.gameTimeText(),weather:this.weather,dt});
      this.updateObjects(dt);
      this.updateNpcs(dt);
      this.updateWildlife(dt);
      if(now()-this.lastPersistenceSaveAt>15000)void this.saveWorldState();
    }
    this.shadowFocus.copy(this.cameraMode==='god'?this.orbit.target:this.camera.position);
    if(this.cameraMode==='firstPerson')this.shadowFocus.y-=1.7;
    this.sunShadow.update(this.cameraMode,this.shadowFocus,this.camera.position.distanceTo(this.orbit.target));
    this.updateRaycast(); this.updateUi(); this.updateSpeech(); this.updateSelectionVisuals();
    if(now()-this.lastHealthPoll>10000) this.refreshHealth();
    this.renderer.render(this.scene,this.camera);
  };

  updatePlayer(dt:number) {
    if(this.interactionOpen||!this.controls.isLocked)return;
    let f=0,r=0;if(this.keys.has('KeyW'))f+=1;if(this.keys.has('KeyS'))f-=1;if(this.keys.has('KeyD'))r+=1;if(this.keys.has('KeyA'))r-=1;
    if(f||r){
      const speed=(this.keys.has('ShiftLeft')?7.2:4.5)*dt;
      const dir=new THREE.Vector3();this.camera.getWorldDirection(dir);dir.y=0;dir.normalize();
      const right=new THREE.Vector3(-dir.z,0,dir.x);const move=dir.multiplyScalar(f).add(right.multiplyScalar(r)).normalize().multiplyScalar(speed);
      const moveInput=()=>({
        id:'player',position:{x:this.camera.position.x,z:this.camera.position.z},
        displacement:{x:move.x,z:move.z},radius:.30,
        dynamic:this.physicsDynamicColliders('player'),
        constraints:[...this.npcs.values()].filter(a=>!a.removed).map(a=>playerHeadConstraint(`npc:${a.state.id}`,a.characterAsset,a.mesh.position,a.mesh.rotation.y))
      });
      let resolved=this.physics.moveKinematic(moveInput());
      const movableHit=resolved.dynamicHits.find(id=>id.startsWith('object:'));
      if(movableHit&&this.tryPushMovableObject(movableHit.slice('object:'.length),{x:move.x,z:move.z})){
        resolved=this.physics.moveKinematic(moveInput());
      }
      this.playerTravel={x:move.x,z:move.z};
      for(const id of resolved.dynamicHits)if(id.startsWith('npc:'))this.playerBlockedNpcs.add(id);
      this.camera.position.x=resolved.position.x;
      this.camera.position.z=resolved.position.z;
    }
    this.camera.position.y=this.groundHeightAt(this.camera.position.x,this.camera.position.z)+1.7;
    this.playerPosition.x=this.camera.position.x;this.playerPosition.z=this.camera.position.z;
    this.firstPersonRotation.copy(this.camera.rotation);
  }

  tryPushMovableObject(objectId:string,displacement:Vec2) {
    const runtime=this.objects.get(objectId);
    if(!runtime?.mesh.visible)return false;
    const state=runtime.state;
    const archetype=worldObjectRigidBody(state);
    if(!archetype)return false;
    const colliderId=`object:${state.id}`;
    const result=resolveMovableBodyStep(this.physics,{
      id:colliderId,
      position:state.position,
      archetype
    },displacement,this.physicsDynamicColliders(colliderId).filter(collider=>collider.id!=='player'));
    if(Math.hypot(result.displacement.x,result.displacement.z)<1e-5)return false;
    state.position={x:result.position.x,z:result.position.z};
    runtime.mesh.position.x=state.position.x;
    runtime.mesh.position.z=state.position.z;
    const triggerRadius=state.kind==='well'||state.kind==='food_stall'?1.45:1.15;
    this.physics.registerTrigger({
      id:`object-trigger:${state.id}`,
      minX:state.position.x-triggerRadius,maxX:state.position.x+triggerRadius,
      minZ:state.position.z-triggerRadius,maxZ:state.position.z+triggerRadius,
      chunkId:state.chunkId,tag:'interaction'
    });
    this.movableDirty=true;
    this.movableSaveRetryMs=1500;
    this.scheduleMovablePersistence();
    return true;
  }

  scheduleMovablePersistence(delayMs=700) {
    if(this.movableSaveTimer!==undefined)window.clearTimeout(this.movableSaveTimer);
    this.movableSaveTimer=window.setTimeout(()=>{
      this.movableSaveTimer=undefined;
      this.persistenceSaveQueued=true;
      void this.saveWorldState();
    },Math.max(250,delayMs));
  }

  updateGodCamera(dt:number) {
    this.orbit.update();
    let f=0,r=0;if(this.keys.has('KeyW'))f+=1;if(this.keys.has('KeyS'))f-=1;if(this.keys.has('KeyD'))r+=1;if(this.keys.has('KeyA'))r-=1;
    const speed=(this.keys.has('ShiftLeft')?20:11)*dt;
    if(f||r){
      const forward=this.orbit.target.clone().sub(this.camera.position);forward.y=0;if(forward.lengthSq()<.001)forward.set(0,0,-1);forward.normalize();
      const right=new THREE.Vector3(-forward.z,0,forward.x);const move=forward.multiplyScalar(f).add(right.multiplyScalar(r)).normalize().multiplyScalar(speed);
      const old=this.orbit.target.clone();this.orbit.target.add(move);
      const bounds=this.coarseWorld.activeBounds();
      this.orbit.target.x=clamp(this.orbit.target.x,bounds.minX,bounds.maxX);
      this.orbit.target.z=clamp(this.orbit.target.z,bounds.minZ,bounds.maxZ);
      const actual=this.orbit.target.clone().sub(old);this.camera.position.add(actual);
    }
    const spin=(this.keys.has('KeyQ')?1:0)-(this.keys.has('KeyE')?1:0);
    if(spin){const off=this.camera.position.clone().sub(this.orbit.target);off.applyAxisAngle(new THREE.Vector3(0,1,0),spin*dt*1.35);this.camera.position.copy(this.orbit.target).add(off);}
    this.orbit.update();
    // Do not materialize a player avatar while observing from god mode.
  }


  async initializePersistence() {
    try{
      const response=await fetch('/api/world/state');
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const data=await response.json() as {snapshot:WorldPersistenceSnapshot|null;revision?:unknown;stats?:unknown};
      const revision=Number(data.revision);
      if(!Number.isSafeInteger(revision)||revision<0)throw new Error('Invalid persistence revision from server');
      this.persistenceRevision=revision;
      this.persistenceConflict=false;
      if(data.snapshot){
        this.restoreWorldState(data.snapshot);
        this.log(`已恢复世界存档 · revision ${revision} · day ${data.snapshot.meta.day} · ${data.snapshot.coarseChunks.length} coarse chunks · ${data.snapshot.fineChunks.length} visited fine chunks`);
      }else{
        this.log(`未发现已有世界存档，将从当前 world seed 开始 · revision ${revision}`);
      }
    }catch(error){
      this.log(`世界存档加载失败，继续使用当前运行时：${error instanceof Error?error.message:String(error)}`);
    }finally{
      this.persistenceReady=true;
      this.lastPersistenceSaveAt=now();
      this.updateFineChunkMaterialization();
    }
  }

  buildWorldSnapshot():WorldPersistenceSnapshot {
    const fine=new Map<string,PersistedFineChunk>();
    for(const [chunkId,cache] of this.fineChunkCache){
      fine.set(chunkId,{chunkId,npcStates:structuredClone(cache.npcStates),objectStates:structuredClone(cache.objectStates),wildlifeStates:structuredClone(cache.wildlifeStates)});
    }
    for(const [chunkId,runtime] of this.materializedChunks){
      fine.set(chunkId,{
        chunkId,
        npcStates:runtime.npcIds.map(id=>this.npcs.get(id)?.state).filter((x):x is NpcState=>Boolean(x)).map(x=>structuredClone(x)),
        objectStates:runtime.objectIds.map(id=>this.objects.get(id)?.state).filter((x):x is WorldObjectState=>Boolean(x)).map(x=>structuredClone(x)),
        wildlifeStates:runtime.wildlifeIds.map(id=>this.wildlife.get(id)?.state).filter((x):x is WildlifeState=>Boolean(x)).map(x=>structuredClone(x))
      });
    }
    const homeNpcs=[...this.npcs.values()].filter(x=>!x.state.chunkId).map(x=>structuredClone(x.state));
    const homeObjects=[...this.objects.values()].filter(x=>!x.state.chunkId).map(x=>structuredClone(x.state));
    return {
      version:1,
      meta:{
        day:this.day,
        minuteOfDay:this.minuteOfDay,
        weather:this.weather,
        playerPosition:{...this.playerPosition},
        playerInventory:{...this.playerInventory}
      },
      coarseChunks:[...this.coarseWorld.chunks.values()].map(x=>structuredClone(x)),
      fineChunks:[...fine.values()],
      homeNpcs,
      homeObjects,
      wildlifeLineage:[...this.wildlifeLineage.values()].map(record=>structuredClone(record)),
      wildlifeTransfers:[...this.wildlifeTransfers.values()].map(transfer=>structuredClone(transfer))
    };
  }

  restoreWorldState(snapshot:WorldPersistenceSnapshot) {
    if(snapshot.version!==1)return;
    this.day=Math.max(1,Math.floor(snapshot.meta.day||1));
    this.minuteOfDay=Math.max(0,Number(snapshot.meta.minuteOfDay)||0);
    this.weather=String(snapshot.meta.weather||'clear');
    this.playerInventory={...this.playerInventory,...snapshot.meta.playerInventory};
    this.playerPosition=restoredPlayerPosition(snapshot.meta.playerPosition);
    this.camera.position.x=this.playerPosition.x;
    this.camera.position.z=this.playerPosition.z;

    this.coarseWorld.restoreKnownChunks(snapshot.coarseChunks||[]);
    this.coarseWorld.ensureWindowAround(this.playerPosition.x,this.playerPosition.z,true);
    this.camera.position.y=this.groundHeightAt(this.playerPosition.x,this.playerPosition.z)+1.7;

    this.wildlifeLineage.clear();
    for(const record of snapshot.wildlifeLineage||[]){
      const normalized=structuredClone(record);
      normalized.origin=normalized.origin==='reproduction'?'reproduction':(normalized.motherId||normalized.fatherId?'reproduction':'founder');
      this.wildlifeLineage.set(normalized.entityId,normalized);
    }
    this.lineageEpoch++;
    this.reconcileLineageOffspring();

    this.wildlifeTransfers.clear();
    for(const transfer of snapshot.wildlifeTransfers||[]){
      if(!transfer?.entityId||!transfer?.state||!transfer.toChunkId)continue;
      this.wildlifeTransfers.set(transfer.entityId,structuredClone(transfer));
    }

    this.fineChunkCache.clear();
    for(const saved of snapshot.fineChunks||[]){
      this.fineChunkCache.set(saved.chunkId,{
        npcStates:structuredClone(saved.npcStates||[]),
        objectStates:structuredClone(saved.objectStates||[]),
        wildlifeStates:structuredClone(saved.wildlifeStates||[])
      });
    }

    for(const saved of snapshot.homeNpcs||[]){
      const runtime=this.npcs.get(saved.id);
      if(!runtime)continue;
      runtime.state=structuredClone(saved);
      runtime.state.chunkId=undefined;
      runtime.mesh.position.set(
        runtime.state.position.x,
        this.groundHeightAt(runtime.state.position.x,runtime.state.position.z),
        runtime.state.position.z
      );
      runtime.mesh.rotation.y=runtime.state.heading??0;
      runtime.yieldPlan=undefined;runtime.task=undefined;runtime.path=[];runtime.pathIndex=0;
      this.alignNpcVisualToGround(runtime);
      runtime.nextDecisionAt=now()+700+Math.random()*1800;
    }

    for(const saved of snapshot.homeObjects||[]){
      if(this.portables.restoreHome(saved))continue;
      const runtime=this.objects.get(saved.id);
      if(!runtime)continue;
      if(runtime.state.kind==='building'){
        // Saved building position is its frontage, never the visible body's center.
        // Keep the layout-owned model/collider/trigger, restoring mutable state only.
        runtime.state=restoreBuildingForLayout(runtime.state,saved);
        continue;
      }
      runtime.state=structuredClone(saved);
      runtime.state.chunkId=undefined;
      normalizeWorldObjectRigidBody(runtime.state);
      runtime.mesh.position.x=runtime.state.position.x;
      runtime.mesh.position.z=runtime.state.position.z;
      if(worldObjectRigidBody(runtime.state))this.registerWorldObjectPhysics(runtime.state);
      if(runtime.state.respawnAt&&runtime.state.respawnAt>Date.now()&&!runtime.state.pickupable)runtime.mesh.visible=false;
      else runtime.mesh.visible=true;
    }
  }

  async saveWorldState() {
    if(!this.persistenceReady||this.persistenceConflict)return;
    if(this.persistenceSaveInFlight){
      this.persistenceSaveQueued=true;
      return;
    }
    let lastSaveSucceeded=false;
    do{
      this.persistenceSaveQueued=false;
      this.persistenceSaveInFlight=true;
      this.lastPersistenceSaveAt=now();
      lastSaveSucceeded=false;
      try{
        this.flushWildlifeHabitatExposure();
        const itemTransferVersion=this.portables.checkpoint.capture();
        const snapshot=this.buildWorldSnapshot();
        const expectedRevision=this.persistenceRevision;
        const response=await fetch('/api/world/state',{
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({snapshot,expectedRevision})
        });
        if(response.status===409){
          const conflict=await response.json().catch(()=>({})) as {currentRevision?:unknown};
          const currentRevision=Number(conflict.currentRevision);
          this.persistenceConflict=true;
          this.persistenceSaveQueued=false;
          throw new Error(Number.isSafeInteger(currentRevision)
            ?`revision conflict (local ${expectedRevision}, server ${currentRevision}); reload required`
            :`revision conflict (local ${expectedRevision}); reload required`);
        }
        if(!response.ok)throw new Error(`HTTP ${response.status}`);
        const saved=await response.json() as {revision?:unknown};
        const revision=Number(saved.revision);
        if(!Number.isSafeInteger(revision)||revision!==expectedRevision+1){
          throw new Error('Invalid persistence revision acknowledgement');
        }
        this.persistenceRevision=revision;
        this.portables.checkpoint.acknowledge(itemTransferVersion);
        lastSaveSucceeded=true;
      }catch(error){
        this.log(`世界自动保存失败：${error instanceof Error?error.message:String(error)}`);
      }finally{
        this.persistenceSaveInFlight=false;
      }
    }while(this.persistenceSaveQueued&&this.persistenceReady&&!this.persistenceConflict);
    if(lastSaveSucceeded){
      this.movableSaveRetryMs=1500;
      if(this.movableSaveTimer===undefined&&!this.persistenceSaveQueued)this.movableDirty=false;
    }else if(!this.persistenceConflict&&this.movableDirty&&this.movableSaveTimer===undefined){
      const retryMs=this.movableSaveRetryMs;
      this.movableSaveRetryMs=Math.min(15000,retryMs*2);
      this.scheduleMovablePersistence(retryMs);
    }
  }

  buildFinalWorldSnapshot():WorldPersistenceSnapshot {
    // Browser unload/beacon requests share a small keepalive body budget. A full discovered-world
    // snapshot can exceed 1 MB, so the final checkpoint intentionally writes only bounded critical
    // session/home state. SQLite save semantics preserve omitted coarse/fine/lineage rows.
    const homeNpcs=[...this.npcs.values()]
      .filter(x=>!x.state.chunkId)
      .map(x=>structuredClone(x.state));
    const homeObjects=[...this.objects.values()]
      .filter(x=>!x.state.chunkId)
      .map(x=>structuredClone(x.state));
    return {
      version:1,
      meta:{
        day:this.day,
        minuteOfDay:this.minuteOfDay,
        weather:this.weather,
        playerPosition:{...this.playerPosition},
        playerInventory:{...this.playerInventory}
      },
      coarseChunks:[],
      fineChunks:[],
      homeNpcs,
      homeObjects,
      // Explicit transfer state is small in normal play and preserves completion/removal semantics.
      // Lineage is append/update-only and can safely wait for the normal full autosave.
      wildlifeTransfers:[...this.wildlifeTransfers.values()].map(transfer=>structuredClone(transfer))
    };
  }

  flushWorldBeacon() {
    // Do not persist only the reward side of an unacknowledged fine parcel transfer.
    if(!this.persistenceReady||this.persistenceConflict||this.portables.checkpoint.pending)return;
    try{
      const snapshot=this.buildFinalWorldSnapshot();
      const payload=JSON.stringify({snapshot,expectedRevision:this.persistenceRevision});
      const accepted=navigator.sendBeacon('/api/world/state',new Blob([payload],{type:'application/json'}));
      if(!accepted)this.log(`最终存档未进入浏览器发送队列 · ${new TextEncoder().encode(payload).byteLength} bytes`);
    }catch{}
  }

  updateFineChunkMaterialization() {
    if(this.cameraMode!=='firstPerson')return;
    this.coarseWorld.ensureWindowAround(this.playerPosition.x,this.playerPosition.z);
    const chunk=this.coarseWorld.chunkAtWorld(this.playerPosition.x,this.playerPosition.z);
    const targetId=chunk?.id;
    if(targetId===this.activeFineChunkId)return;
    if(this.activeFineChunkId&&chunk)this.transferOwnedFollowersToChunk(this.activeFineChunkId,chunk);
    if(this.activeFineChunkId)this.collapseFineChunk(this.activeFineChunkId);
    if(chunk)this.materializeFineChunk(chunk);
  }

  materializeFineChunk(chunk:CoarseChunkState) {
    if(this.materializedChunks.has(chunk.id))return;
    const plan=planFineChunk(chunk,this.coarseWorld.chunkSize);
    const runtime:FineChunkRuntime={
      chunkId:chunk.id,npcIds:[],objectIds:[],wildlifeIds:[],initialWildlifeCounts:{},
      initialWildlifeIds:new Set<string>(),fixedWildlifeWeights:new Map<string,number>(),groups:[],
      initialMetrics:{food:0,wood:0,ecology:0,prosperity:0,shrub:0,fruit:0,crop:0}
    };
    this.materializedChunks.set(chunk.id,runtime);
    this.coarseWorld.setMaterialized(chunk.id,true);
    registerFineTerrainForChunk(this.physics,chunk,this.coarseWorld.chunkSize);
    if(this.cameraMode==='firstPerson'){
      this.camera.position.y=this.groundHeightAt(this.playerPosition.x,this.playerPosition.z)+1.7;
    }

    const cached=this.fineChunkCache.get(chunk.id);
    const cachedObjects=new Map((cached?.objectStates||[]).map(state=>[state.id,state]));
    const cachedNpcs=new Map((cached?.npcStates||[]).map(state=>[state.id,state]));

    for(const road of plan.roads){
      const saved=cachedObjects.get(road.id);
      const state:WorldObjectState=structuredClone(saved||{
        id:road.id,chunkId:chunk.id,kind:'road',name:road.name,position:{x:road.x,z:road.z},
        tags:road.tags,usable:true,pickupable:false,capabilities:['inspect']
      });
      state.chunkId=chunk.id;
      const mesh=new THREE.Mesh(
        new THREE.BoxGeometry(road.w,.045,road.d),
        new THREE.MeshStandardMaterial({color:road.tags.includes('trail')?0xa68d67:0xc3aa7d,roughness:1})
      );
      mesh.position.set(road.x,.025,road.z);mesh.receiveShadow=true;
      mesh.userData={entityType:'object',entityId:road.id};
      this.scene.add(mesh);
      this.objects.set(road.id,{state,mesh});
      runtime.objectIds.push(road.id);runtime.groups.push(mesh);
    }

    for(const b of plan.buildings){
      this.addBuilding(b.name,b.x,b.z,b.w,b.d,b.color,b.asset,b.height,b.rotationY,{id:b.id,chunkId:chunk.id});
      runtime.objectIds.push(b.id);
      const saved=cachedObjects.get(b.id);
      const object=this.objects.get(b.id);
      if(saved&&object)Object.assign(object.state,restoreBuildingForLayout(object.state,saved));
    }

    for(const p of plan.objects){
      const saved=cachedObjects.get(p.state.id);
      const state=structuredClone(saved||p.state);
      state.chunkId=chunk.id;
      if(state.kind!=='dropped_item'&&state.resourceAmount!==undefined&&state.resourceCapacity===undefined)state.resourceCapacity=state.resourceAmount;
      this.addObject(state,p.asset,p.height,p.rotationY||0);
      runtime.objectIds.push(state.id);
    }

    this.portables.restoreFine(cached?.objectStates||[],chunk.id);

    for(const p of plan.residents){
      const saved=cachedNpcs.get(p.id);
      const state:NpcState=saved?structuredClone(saved):{
        id:p.id,chunkId:chunk.id,name:p.name,role:p.role,position:{x:p.x,z:p.z},home:{x:p.x,z:p.z},
        workAt:p.workAt,mood:p.mood,hunger:25+Math.random()*24,energy:62+Math.random()*28,social:42+Math.random()*32,
        money:Math.max(2,Math.round(3+chunk.prosperity/7)),inventory:structuredClone(p.inventory),
        relationships:{},memories:[],currentAction:'idle',goal:'在这里生活并照顾自己的日常需要',lastDecisionAt:0
      };
      state.chunkId=chunk.id;
      this.spawnFineNpc(state,p.characterAsset);
      runtime.npcIds.push(state.id);
    }

    const pendingTransfers=[...this.wildlifeTransfers.values()]
      .filter(transfer=>transfer.toChunkId===chunk.id)
      .sort((a,b)=>a.transferredDay-b.transferredDay||a.entityId.localeCompare(b.entityId));
    const pendingReplacement=new Map<WildlifeSpecies,number>();
    if(!cached){
      const remainingBySpecies=new Map<WildlifeSpecies,number>();
      for(const population of chunk.wildlife||[])remainingBySpecies.set(population.species,Math.max(0,population.count));
      for(const transfer of pendingTransfers){
        if(this.wildlifeLineage.get(transfer.entityId)?.deathDay!==undefined)continue;
        const species=transfer.state.species;
        const remaining=remainingBySpecies.get(species)||0;
        const effective=Math.min(Math.max(0,transfer.representedPopulation),remaining);
        if(effective<=.01)continue;
        pendingReplacement.set(species,(pendingReplacement.get(species)||0)+1);
        remainingBySpecies.set(species,remaining-effective);
      }
    }

    if(cached){
      for(const saved of cached.wildlifeStates){
        const state=structuredClone(saved);
        state.chunkId=chunk.id;
        state.ageDays=Math.max(state.ageDays,(this.day+this.minuteOfDay/1440)-state.birthDay);
        if(this.spawnWildlife(state)){
          runtime.wildlifeIds.push(state.id);
          runtime.initialWildlifeIds.add(state.id);
          if((state.representedPopulation||0)>0)runtime.fixedWildlifeWeights.set(state.id,state.representedPopulation!);
          else runtime.initialWildlifeCounts[state.species]=(runtime.initialWildlifeCounts[state.species]||0)+1;
        }
      }
    }else{
      for(const p of plan.wildlife){
        const replacements=pendingReplacement.get(p.species)||0;
        if(replacements>0){pendingReplacement.set(p.species,replacements-1);continue;}
        const population=chunk.wildlife?.find(x=>x.species===p.species);
        const state:WildlifeState={
          id:p.id,chunkId:chunk.id,species:p.species,position:{x:p.x,z:p.z},ageDays:p.ageDays,
          health:clamp((population?.health??82)+(Math.random()-.5)*8,0,100),hunger:20+Math.random()*28,thirst:18+Math.random()*30,energy:62+Math.random()*28,
          diseaseLoad:population?.diseaseLoad??0,
          sex:p.sex,generation:p.generation,traits:structuredClone(p.traits),currentAction:'wander',
          lastDecisionAt:0,birthDay:Math.max(1,this.day-Math.floor(p.ageDays))
        };
        if(this.spawnWildlife(state)){
          runtime.wildlifeIds.push(state.id);
          runtime.initialWildlifeIds.add(state.id);
          if((state.representedPopulation||0)>0)runtime.fixedWildlifeWeights.set(state.id,state.representedPopulation!);
          else runtime.initialWildlifeCounts[state.species]=(runtime.initialWildlifeCounts[state.species]||0)+1;
        }
      }
    }
    this.materializePendingWildlifeTransfers(chunk,runtime,pendingTransfers);

    runtime.initialMetrics=this.fineMetrics(runtime);
    this.activeFineChunkId=chunk.id;
    this.event(`远区 ${chunk.cx},${chunk.cz} 已展开为细粒度世界。`);
    this.log(`Materialized ${chunk.id} [${plan.archetype}]: ${runtime.npcIds.length} NPCs / ${runtime.wildlifeIds.length} wildlife / ${runtime.objectIds.length} objects / ${plan.roads.length} roads`);
  }

  materializePendingWildlifeTransfers(chunk:CoarseChunkState,runtime:FineChunkRuntime,transfers:PersistedWildlifeTransfer[]) {
    for(const transfer of transfers){
      if(this.wildlifeTransfers.get(transfer.entityId)!==transfer)continue;
      if(runtime.wildlifeIds.includes(transfer.entityId)||this.wildlifeLineage.get(transfer.entityId)?.deathDay!==undefined){
        this.wildlifeTransfers.delete(transfer.entityId);
        continue;
      }
      const population=chunk.wildlife?.find(entry=>entry.species===transfer.state.species);
      if(!population||population.count<=0)continue;
      let alreadyFixed=0;
      for(const [id,weight] of runtime.fixedWildlifeWeights){
        if(this.wildlifeLineage.get(id)?.species===transfer.state.species)alreadyFixed+=weight;
      }
      const availableWeight=Math.max(0,population.count-alreadyFixed);
      const effectiveWeight=Math.min(Math.max(0,transfer.representedPopulation),availableWeight);
      if(effectiveWeight<=.01)continue;

      const state=structuredClone(transfer.state);
      state.chunkId=chunk.id;
      state.ageDays=Math.max(state.ageDays,(this.day+this.minuteOfDay/1440)-state.birthDay);
      state.position=this.randomPassableNear(state.position,3,chunk.id);
      state.representedPopulation=effectiveWeight;
      state.currentAction='wander';
      state.targetObjectId=undefined;state.targetWildlifeId=undefined;state.targetChunkId=undefined;
      if(!this.spawnWildlife(state))continue;
      runtime.wildlifeIds.push(state.id);
      runtime.initialWildlifeIds.add(state.id);
      runtime.fixedWildlifeWeights.set(state.id,effectiveWeight);
      this.wildlifeTransfers.delete(transfer.entityId);
      this.event(`${this.wildlifeName(state.species)} ${state.id} 已进入 ${chunk.id}。`);
    }
  }

  spawnFineNpc(state:NpcState,characterAsset:string) {
    const mesh=new THREE.Group();
    mesh.position.set(state.position.x,this.groundHeightAt(state.position.x,state.position.z),state.position.z);
    mesh.rotation.y=state.heading??0;
    mesh.userData={entityType:'npc',entityId:state.id};
    this.scene.add(mesh);

    const speechEl=document.createElement('div');speechEl.className='speech hidden';ui.speechLayer.appendChild(speechEl);
    const nameEl=document.createElement('div');nameEl.className='npc-name hidden';ui.speechLayer.appendChild(nameEl);
    const agent:NpcRuntime={
      state,characterAsset,mesh,path:[],pathIndex:0,nextDecisionAt:now()+800+Math.random()*3500,
      pendingDecision:false,speechEl,nameEl
    };
    this.npcs.set(state.id,agent);

    for(const other of this.npcs.values()){
      if(other===agent)continue;
      state.relationships[other.state.id]??={affinity:45+Math.round(Math.random()*15),trust:45+Math.round(Math.random()*15),familiarity:12};
      other.state.relationships[state.id]??={affinity:48,trust:48,familiarity:8};
    }
    state.relationships.player??={affinity:50,trust:50,familiarity:5};

    this.attachVisualTarget({group:mesh,asset:characterAsset,height:1.82,rotationY:0});
    if(state.chunkId)this.materializedChunks.get(state.chunkId)?.groups.push(mesh);
  }

  spawnWildlife(state:WildlifeState) {
    const archived=this.wildlifeLineage.get(state.id);
    if(archived?.deathDay!==undefined)return false;
    state.phenotype=normalizeWildlifePhenotype(state.phenotype,state.id);
    state.organismGenome=normalizeWildlifeOrganismGenome(state.species,state.organismGenome,state.id);
    state.domestication=normalizeWildlifeDomestication(state.species,state.domestication);
    this.ensureWildlifeLineage(state);
    this.beginWildlifeHabitatObservation(state);
    const g=state.species==='raccoon'?new THREE.Group():this.makeProceduralAnimal(state);
    g.position.set(state.position.x,this.groundHeightAt(state.position.x,state.position.z),state.position.z);
    g.userData={entityType:'wildlife',entityId:state.id};
    this.scene.add(g);
    const runtime:WildlifeRuntime={state,mesh:g,path:[],pathIndex:0,controllerSpeed:0,nextDecisionAt:now()+2500+Math.random()*7000,actionResolved:true};
    this.wildlife.set(state.id,runtime);
    this.wildlifePresentation.register(runtime);
    if(state.chunkId)this.materializedChunks.get(state.chunkId)?.groups.push(g);
    return true;
  }

  makeProceduralAnimal(state:WildlifeState) {
    const g=new THREE.Group();
    const phenotype=normalizeWildlifePhenotype(state.phenotype,state.id);
    const genome=normalizeWildlifeOrganismGenome(state.species,state.organismGenome,state.id);
    const morphology=effectiveWildlifeMorphology(state.species,phenotype);
    const materialColor=(base:number,hueExtra=0)=>{
      const color=new THREE.Color(base);
      const hsl={h:0,s:0,l:0};color.getHSL(hsl);
      color.setHSL((hsl.h+genome.material.hueShift+hueExtra+1)%1,hsl.s,clamp(hsl.l+genome.material.lightnessShift,.06,.94));
      return color;
    };
    const scale=Math.max(.55,state.traits.size);
    const bodyMaterial=new THREE.MeshStandardMaterial({color:materialColor(morphology.body),roughness:.95});
    const accentMaterial=new THREE.MeshStandardMaterial({color:materialColor(morphology.accent,genome.material.accentShift),roughness:.95});
    const featureMaterial=new THREE.MeshStandardMaterial({color:materialColor(morphology.featureColor??morphology.body,genome.material.accentShift*.5),roughness:1});
    const bodyCenter=(morphology.legHeight*.5+morphology.bodyY*.45)*scale;
    const headZ=morphology.bodyZ*.95*scale;
    const headY=bodyCenter+morphology.bodyY*.26*scale;
    const body=new THREE.Mesh(
      new THREE.BoxGeometry(morphology.bodyX*scale,morphology.bodyY*scale,morphology.bodyZ*scale),
      bodyMaterial
    );
    body.position.y=bodyCenter;
    const head=new THREE.Mesh(
      new THREE.BoxGeometry(morphology.headSize*scale,morphology.headSize*scale,morphology.headSize*scale),
      accentMaterial
    );
    head.position.set(0,headY,headZ);
    g.add(body,head);
    for(const sx of [-.33,.33])for(const sz of [-.33,.33]){
      const leg=new THREE.Mesh(
        new THREE.BoxGeometry(.14*scale,morphology.legHeight*scale,.14*scale),
        bodyMaterial
      );
      leg.position.set(sx*morphology.bodyX*scale,morphology.legHeight*.5*scale,sz*morphology.bodyZ*scale);
      g.add(leg);
    }
    for(const feature of morphology.features){
      if(feature==='long_ears'){
        for(const x of [-.12,.12]){
          const ear=new THREE.Mesh(new THREE.BoxGeometry(.1*scale,.55*scale,.1*scale),accentMaterial);
          ear.position.set(x*scale,headY+.46*scale,headZ);g.add(ear);
        }
      }else if(feature==='antlers'){
        for(const x of [-.16,.16]){
          const antler=new THREE.Mesh(new THREE.BoxGeometry(.06*scale,.48*scale,.06*scale),featureMaterial);
          antler.position.set(x*scale,headY+.36*scale,headZ);g.add(antler);
        }
      }else if(feature==='horns'){
        for(const x of [-.15,.15]){
          const horn=new THREE.Mesh(new THREE.BoxGeometry(.07*scale,.42*scale,.07*scale),featureMaterial);
          horn.position.set(x*scale,headY+.31*scale,headZ);horn.rotation.x=-.22;g.add(horn);
        }
      }else if(feature==='tail'){
        const tailLength=morphology.tailLength??.6;
        const tail=new THREE.Mesh(new THREE.BoxGeometry(.25*scale,.25*scale,tailLength*scale),bodyMaterial);
        tail.position.set(0,bodyCenter,-(morphology.bodyZ*.5+tailLength*.52)*scale);tail.rotation.x=-.35;g.add(tail);
      }else if(feature==='dorsal_stripe'){
        const stripe=new THREE.Mesh(
          new THREE.BoxGeometry(Math.max(.12,morphology.bodyX*.16)*scale,.045*scale,morphology.bodyZ*1.04*scale),
          featureMaterial
        );
        stripe.position.set(0,bodyCenter+morphology.bodyY*.51*scale,0);g.add(stripe);
        const faceStripe=new THREE.Mesh(new THREE.BoxGeometry(.12*scale,.05*scale,morphology.headSize*1.02*scale),featureMaterial);
        faceStripe.position.set(0,headY+morphology.headSize*.48*scale,headZ);g.add(faceStripe);
      }else if(feature==='ear_tufts'){
        for(const x of [-.15,.15]){
          const tuft=new THREE.Mesh(new THREE.ConeGeometry(.055*scale,.28*scale,5),featureMaterial);
          tuft.position.set(x*scale,headY+.38*scale,headZ);g.add(tuft);
        }
      }else if(feature==='face_mask'){
        const mask=new THREE.Mesh(
          new THREE.BoxGeometry(morphology.headSize*.96*scale,.14*scale,.06*scale),
          featureMaterial
        );
        mask.position.set(0,headY+.04*scale,headZ+morphology.headSize*.48*scale);g.add(mask);
      }else if(feature==='ringed_tail'){
        const tailLength=morphology.tailLength??.68;
        const tailGroup=new THREE.Group();
        const segments=5;
        for(let i=0;i<segments;i++){
          const material=i%2===0?bodyMaterial:featureMaterial;
          const segment=new THREE.Mesh(
            new THREE.BoxGeometry(.22*scale,.22*scale,(tailLength/segments)*scale),
            material
          );
          segment.position.z=-(i+.5)*(tailLength/segments)*scale;
          tailGroup.add(segment);
        }
        tailGroup.position.set(0,bodyCenter,-morphology.bodyZ*.5*scale);
        tailGroup.rotation.x=-.30;g.add(tailGroup);
      }
    }
    g.traverse(o=>{const mesh=o as THREE.Mesh;if(mesh.isMesh){mesh.castShadow=true;mesh.receiveShadow=true;}});
    return g;
  }

  fineMetrics(runtime:FineChunkRuntime):FineMetrics {
    let food=0,wood=0,ecology=0,prosperity=0,shrub=0,fruit=0,crop=0;
    for(const id of runtime.objectIds){
      const o=this.objects.get(id)?.state;if(!o)continue;
      if(o.kind==='dropped_item'){
        if(o.item){const value=portableItemMetrics(o.item,droppedItemCount(o));food+=value.food;wood+=value.wood;prosperity+=value.prosperity;}
        continue;
      }
      const amount=Math.max(0,o.resourceAmount||0);
      if(o.item==='apple'||o.item==='grain'||o.item==='bread'||o.item==='flour')food+=amount;
      if(o.kind==='farm_plot')crop+=amount;
      if(o.kind==='bush'||o.kind==='flower')shrub+=amount;
      if(o.kind==='tree'&&o.tags.includes('apple'))fruit+=amount;
      if(o.item==='wood'||o.tags.includes('wood'))wood+=amount;
      if(['tree','bush','flower'].includes(o.kind))ecology+=amount;
      for(const slot of o.storage||[]){
        if(['apple','grain','flour','bread'].includes(slot.kind))food+=slot.count;
        if(slot.kind==='wood'||slot.kind==='plank')wood+=slot.count;
        prosperity+=slot.kind==='tool'?slot.count*2:slot.count*.25;
      }
    }
    for(const id of runtime.npcIds){
      const n=this.npcs.get(id)?.state;if(!n)continue;
      prosperity+=n.money;
      for(const slot of n.inventory){
        const value=portableItemMetrics(slot.kind,slot.count);
        food+=value.food;wood+=value.wood;prosperity+=value.prosperity;
      }
    }
    return {food,wood,ecology,prosperity,shrub,fruit,crop};
  }

  collapseFineChunk(chunkId:string) {
    const runtime=this.materializedChunks.get(chunkId);if(!runtime)return;
    const chunk=this.coarseWorld.chunks.get(chunkId);
    const current=this.fineMetrics(runtime);
    const initial=runtime.initialMetrics;

    if(chunk){
      this.coarseWorld.applyFineSummary(chunkId,{
        food:chunk.food+(current.food-initial.food)*.7,
        wood:chunk.wood+(current.wood-initial.wood)*.6,
        ecology:chunk.ecology+(current.ecology-initial.ecology)*.35,
        prosperity:chunk.prosperity+(current.prosperity-initial.prosperity)*.16
      });
      if(chunk.plants){
        chunk.plants.shrub=clamp(chunk.plants.shrub+(current.shrub-initial.shrub)*.8,0,100);
        chunk.plants.fruit=clamp(chunk.plants.fruit+(current.fruit-initial.fruit)*.9,0,100);
        chunk.plants.crop=clamp(chunk.plants.crop+(current.crop-initial.crop)*.9,0,100);
      }
    }

    const npcStates: NpcState[]=[];
    for(const id of runtime.npcIds){
      const agent=this.npcs.get(id);if(!agent)continue;
      agent.removed=true;agent.task=undefined;agent.path=[];
      npcStates.push(structuredClone(agent.state));
      agent.mesh.parent?.remove(agent.mesh);
      agent.speechEl.remove();agent.nameEl.remove();
      this.npcs.delete(id);
    }

    for(const id of [...runtime.wildlifeIds]){
      const animal=this.wildlife.get(id);
      if(!animal||animal.removed||animal.state.currentAction!=='migrate'||!animal.state.targetChunkId)continue;
      const physicalChunk=this.coarseWorld.chunkAtWorld(animal.mesh.position.x,animal.mesh.position.z);
      if(physicalChunk?.id===animal.state.targetChunkId)this.completeFineWildlifeMigration(animal,animal.state.targetChunkId);
    }

    const wildlifeStates:WildlifeState[]=[];
    const currentOrdinaryCounts:Partial<Record<WildlifeSpecies,number>>={};
    const currentFixedWeights:Partial<Record<WildlifeSpecies,number>>={};
    const ordinaryDiseaseTotals:Partial<Record<WildlifeSpecies,number>>={};
    const fixedDiseaseTotals:Partial<Record<WildlifeSpecies,number>>={};
    for(const id of runtime.wildlifeIds){
      const animal=this.wildlife.get(id);if(!animal)continue;
      this.endWildlifeHabitatObservation(animal.state);
      wildlifeStates.push(structuredClone(animal.state));
      const species=animal.state.species;
      const fixedWeight=runtime.fixedWildlifeWeights.get(id)||0;
      if(fixedWeight>0){
        currentFixedWeights[species]=(currentFixedWeights[species]||0)+fixedWeight;
        fixedDiseaseTotals[species]=(fixedDiseaseTotals[species]||0)+(animal.state.diseaseLoad||0)*fixedWeight;
      }else{
        currentOrdinaryCounts[species]=(currentOrdinaryCounts[species]||0)+1;
        ordinaryDiseaseTotals[species]=(ordinaryDiseaseTotals[species]||0)+(animal.state.diseaseLoad||0);
      }
      animal.removed=true;
      this.wildlifePresentation.remove(animal);
      animal.mesh.parent?.remove(animal.mesh);
      this.wildlife.delete(id);
    }
    if(chunk?.wildlife){
      for(const population of chunk.wildlife){
        const initialOrdinary=runtime.initialWildlifeCounts[population.species]||0;
        const currentOrdinary=currentOrdinaryCounts[population.species]||0;
        let initialFixedWeight=0;
        for(const [id,weight] of runtime.fixedWildlifeWeights){
          if(this.wildlifeLineage.get(id)?.species===population.species)initialFixedWeight+=weight;
        }
        const currentFixedWeight=currentFixedWeights[population.species]||0;
        if(initialOrdinary<=0&&currentOrdinary<=0&&initialFixedWeight<=0&&currentFixedWeight<=0)continue;
        const folded=foldFineWildlifePopulationCount(
          population.count,initialOrdinary,currentOrdinary,initialFixedWeight,currentFixedWeight
        );
        population.count=folded.nextCount;
        const representedAlive=currentOrdinary*folded.ordinaryWeight+currentFixedWeight;
        if(representedAlive>0){
          const diseaseWeighted=(ordinaryDiseaseTotals[population.species]||0)*folded.ordinaryWeight+(fixedDiseaseTotals[population.species]||0);
          population.diseaseLoad=clamp(diseaseWeighted/representedAlive,0,100);
        }
      }
    }

    const objectStates: WorldObjectState[]=[];
    for(const id of runtime.objectIds){
      const object=this.objects.get(id);if(!object)continue;
      objectStates.push(structuredClone(object.state));
      object.mesh.parent?.remove(object.mesh);
      this.objects.delete(id);
    }

    this.physics.clearChunk(chunkId);
    this.visualTargets=this.visualTargets.filter(target=>!runtime.groups.includes(target.group));
    this.fineChunkCache.set(chunkId,{npcStates,objectStates,wildlifeStates});
    this.materializedChunks.delete(chunkId);
    this.coarseWorld.setMaterialized(chunkId,false);
    if(this.activeFineChunkId===chunkId)this.activeFineChunkId=undefined;
    if(this.selectedEntity&&(runtime.npcIds.includes(this.selectedEntity.id)||runtime.objectIds.includes(this.selectedEntity.id)||runtime.wildlifeIds.includes(this.selectedEntity.id)))this.selectedEntity=undefined;
    if(this.hoverEntity&&(runtime.npcIds.includes(this.hoverEntity.id)||runtime.objectIds.includes(this.hoverEntity.id)||runtime.wildlifeIds.includes(this.hoverEntity.id)))this.hoverEntity=undefined;
    this.event(`远区 ${chunkId} 已折叠回粗粒度模拟。`);
    this.log(`Collapsed ${chunkId} back to coarse state`);
  }

  updateTime(dt:number) {
    this.minuteOfDay += dt*2.2;
    if(this.minuteOfDay>=1440){this.minuteOfDay-=1440;this.day++;this.weatherEpoch=-1;this.event(`第 ${this.day} 天开始了。`);}
    const block=Math.floor(this.minuteOfDay/360);
    if(block!==this.weatherEpoch){this.weatherEpoch=block;const roll=Math.random();this.weather=roll<.68?'clear':roll<.88?'cloudy':'rain';}
    const phase=(this.minuteOfDay/1440)*Math.PI*2-Math.PI/2; const daylight=clamp(Math.sin(phase)*.7+.45,.12,1);
    this.sun.intensity=.15+daylight*1.65; this.ambient.intensity=.32+daylight*1.05;
    const sky=new THREE.Color().setHSL(.56,.55,.12+daylight*.58); this.scene.background=sky; if(this.scene.fog)this.scene.fog.color.copy(sky);
  }

  updateObjects(dt:number) {
    const t=Date.now();
    const season=this.worldSeason();
    const seasonFactor=season==='spring'?1.35:season==='summer'?1.0:season==='autumn'?.72:.24;
    const weatherFactor=this.weather==='rain'?1.35:this.weather==='cloudy'?1.05:.9;
    for(const o of this.objects.values()){
      if(advancePickupRespawn(o.state,t))o.mesh.visible=true;
      const s=o.state;
      if(s.resourceCapacity===undefined||s.resourceAmount===undefined||s.resourceAmount>=s.resourceCapacity)continue;
      let rate=0;
      if(s.kind==='farm_plot')rate=.0025*seasonFactor*weatherFactor;
      else if(s.kind==='bush'||s.kind==='flower')rate=.0018*seasonFactor*weatherFactor;
      else if(s.kind==='tree'&&s.tags.includes('apple'))rate=.0012*seasonFactor*weatherFactor;
      else if(s.kind==='water_patch')rate=this.weather==='rain'?.0045:.0005;
      if(rate>0)s.resourceAmount=Math.min(s.resourceCapacity,s.resourceAmount+rate*dt);
    }
  }

  applyOwnedWildlifeCommand(animal:WildlifeRuntime) {
    const s=animal.state;
    const domestication=normalizeWildlifeDomestication(s.species,s.domestication);
    s.domestication=domestication;
    if(!domestication?.ownerId||domestication.command==='none')return false;

    s.targetObjectId=undefined;s.targetWildlifeId=undefined;s.targetChunkId=undefined;
    if(domestication.command==='stay'){
      animal.path=[];animal.pathIndex=0;animal.controllerSpeed=0;animal.actionResolved=true;
      s.currentAction='rest';
      return true;
    }

    if(domestication.command==='follow'){
      if(domestication.ownerId!=='player'||this.cameraMode!=='firstPerson'){
        animal.path=[];animal.pathIndex=0;animal.controllerSpeed=0;animal.actionResolved=true;
        s.currentAction='rest';
        return true;
      }
      const ownerPosition=this.playerPosition;
      const ownerDistance=dist(s.position,ownerPosition);
      if(ownerDistance<=2.2){
        animal.path=[];animal.pathIndex=0;animal.controllerSpeed=0;animal.actionResolved=true;
        s.currentAction='rest';
        return true;
      }
      const finalWaypoint=animal.path.length?animal.path[animal.path.length-1]:undefined;
      if(!finalWaypoint||dist(finalWaypoint,ownerPosition)>2.2){
        const target=this.randomPassableNear(ownerPosition,1.1,s.chunkId);
        animal.path=this.findPath(s.position,target);animal.pathIndex=0;animal.controllerSpeed=0;
      }
      s.currentAction='wander';animal.actionResolved=true;
      return true;
    }

    if(domestication.command==='graze'){
      if(s.hunger<28){
        animal.path=[];animal.pathIndex=0;animal.controllerSpeed=0;animal.actionResolved=true;
        s.currentAction='rest';
        animal.nextDecisionAt=Math.max(animal.nextDecisionAt,now()+3500);
        return true;
      }
      if(animal.path.length===0&&animal.actionResolved&&now()>=animal.nextDecisionAt){
        const action=wildlifeSpeciesProfile(s.species).feedingAction;
        this.applyWildlifeDecision(animal,{
          wildlifeId:s.id,source:'owner-command',action,confidence:1,reasonCode:'owner_feed'
        });
      }
      return true;
    }

    return false;
  }

  updateWildlife(dt:number) {
    for(const animal of [...this.wildlife.values()]){
      if(animal.removed)continue;
      const s=animal.state;
      s.ageDays+=dt*2.2/1440;
      this.maybeCompleteWildlifePregnancy(animal);
      const functional=wildlifeFunctionalPhenotype(normalizeWildlifePhenotype(s.phenotype,s.id));
      s.hunger=clamp(s.hunger+dt*.22*functional.maintenanceMultiplier,0,100);
      s.thirst=clamp(s.thirst+dt*.30*functional.maintenanceMultiplier,0,100);
      s.energy=clamp(s.energy-dt*.045*functional.maintenanceMultiplier,0,100);
      const maxAge=this.wildlifeLifeHistory(s.species).maxAge;
      const agePressure=Math.max(0,s.ageDays/maxAge-.72);
      const nearbyDisease=[...this.wildlife.values()]
        .filter(x=>x!==animal&&!x.removed&&dist(s.position,x.state.position)<4.5)
        .map(x=>{
          const distance=Math.max(.4,dist(s.position,x.state.position));
          const contact=wildlifeDiseaseContactCoefficient(x.state.species,s.species);
          const proximity=clamp(1-distance/4.5,0,1);
          return {load:x.state.diseaseLoad||0,weight:contact*(.35+proximity*.65)};
        })
        .filter(x=>x.weight>0);
      const contactWeight=nearbyDisease.reduce((sum,x)=>sum+x.weight,0);
      const contactExposure=contactWeight>0?nearbyDisease.reduce((sum,x)=>sum+x.load*x.weight,0)/contactWeight:0;
      const coarseChunk=this.coarseWorld.chunks.get(s.chunkId);
      const coarsePressure=coarseChunk?.wildlifeDisease?.speciesPressure[s.species]??coarseChunk?.wildlife?.find(x=>x.species===s.species)?.diseaseLoad??0;
      const environmental=(coarseChunk?.biome==='wetlands'?10:0)+(this.weather==='rain'?7:this.weather==='cloudy'?2:0);
      const exposure=clamp(contactExposure*.68+coarsePressure*.22+environmental*.10,0,100);
      const load=s.diseaseLoad||0;
      s.diseaseLoad=clamp(load+Math.max(0,exposure-load)*dt*.0019-dt*.0022,0,100);
      if(s.hunger>95||s.thirst>95)s.health=clamp(s.health-dt*.65,0,100);
      else if(s.hunger<55&&s.thirst<55)s.health=clamp(s.health+dt*.025,0,100);
      s.health=clamp(s.health-agePressure*dt*.12-(s.diseaseLoad||0)*dt*.0015,0,100);
      if(s.health<=0){this.removeWildlife(animal,this.classifyWildlifeDeath(s));continue;}

      this.applyOwnedWildlifeCommand(animal);
      const beforeMoveX=animal.mesh.position.x;
      const beforeMoveZ=animal.mesh.position.z;
      this.moveWildlife(animal,dt);
      const actualSpeed=Math.hypot(animal.mesh.position.x-beforeMoveX,animal.mesh.position.z-beforeMoveZ)/Math.max(dt,0.000001);
      animal.mesh.position.y=this.groundHeightAt(animal.mesh.position.x,animal.mesh.position.z);
      if(animal.path.length===0&&!animal.actionResolved)this.completeWildlifeAction(animal);
      if(animal.removed)continue;
      this.wildlifePresentation.update(animal,{speed:actualSpeed,action:s.currentAction,deltaSeconds:dt});
      s.position.x=animal.mesh.position.x;s.position.z=animal.mesh.position.z;
      this.recordWildlifeHabitatExposure(s);
    }
    if(!this.aiPaused&&!this.wildlifeDecisionPending&&this.wildlife.size&&now()>=this.nextWildlifeBatchAt){
      void this.requestWildlifeBatch();
    }
  }

  moveWildlife(animal:WildlifeRuntime,dt:number) {
    if(animal.pathIndex>=animal.path.length){
      animal.path=[];animal.pathIndex=0;animal.controllerSpeed=0;return;
    }
    const p=animal.path[animal.pathIndex]!;
    const pos=animal.mesh.position;
    const fastAction=['flee','hunt','migrate'].includes(animal.state.currentAction);
    const functional=wildlifeFunctionalPhenotype(normalizeWildlifePhenotype(animal.state.phenotype,animal.state.id));
    const genome=normalizeWildlifeOrganismGenome(animal.state.species,animal.state.organismGenome,animal.state.id);
    const locomotion=wildlifeOrganismLocomotion(genome);
    const movement=wildlifeSpeciesProfile(animal.state.species).movement;
    const maxSpeed=animal.state.traits.speed*functional.movementSpeedMultiplier*locomotion.speedMultiplier*movement.speedMultiplier*(fastAction?1.18:1);
    const step=stepWildlifeMovementController({
      x:pos.x,z:pos.z,targetX:p.x,targetZ:p.z,maxSpeed,dt,profile:movement,
      state:{speed:animal.controllerSpeed,heading:animal.mesh.rotation.y}
    });
    animal.mesh.rotation.y=step.heading;
    if(step.arrived){
      animal.controllerSpeed=0;
      animal.pathIndex++;
      if(animal.pathIndex>=animal.path.length){animal.path=[];animal.pathIndex=0;}
      return;
    }

    const resolved=this.physics.moveKinematic({
      id:`wildlife:${animal.state.id}`,
      position:{x:pos.x,z:pos.z},
      displacement:{x:step.dx,z:step.dz},
      radius:this.wildlifePhysicsRadius(animal.state),
      dynamic:this.physicsDynamicColliders(`wildlife:${animal.state.id}`)
    });
    pos.x=resolved.position.x;pos.z=resolved.position.z;
    if(resolved.collided&&animal.pathIndex===animal.path.length-1&&step.distance<=1.55){
      animal.path=[];animal.pathIndex=0;animal.controllerSpeed=0;
      return;
    }
    const requestedDistance=Math.hypot(step.dx,step.dz);
    const realizedDistance=Math.hypot(resolved.displacement.x,resolved.displacement.z);
    const realizedRatio=requestedDistance>1e-6?clamp(realizedDistance/requestedDistance,0,1):0;
    animal.controllerSpeed=step.speed*realizedRatio;
    const movementLoad=maxSpeed>0?clamp(animal.controllerSpeed/maxSpeed,.18,1):0;
    animal.state.energy=clamp(
      animal.state.energy-dt*.018*movementLoad*functional.movementEnergyMultiplier*locomotion.energyMultiplier*movement.energyMultiplier*(fastAction?functional.fastActionEnergyMultiplier*movement.fastActionMultiplier*1.45:1),
      0,100
    );
  }

  wildlifeAllowedActions(state:WildlifeState):WildlifeAction[] {
    const profile=wildlifeSpeciesProfile(state.species);
    const life=this.wildlifeLifeHistory(state.species);
    const currentDay=this.day+this.minuteOfDay/1440;
    const pregnant=state.sex==='female'&&Boolean(state.pregnantUntilDay&&state.pregnantUntilDay>currentDay);
    const baseline=this.materializedChunks.get(state.chunkId)?.initialWildlifeIds.has(state.id)??false;
    const domestication=normalizeWildlifeDomestication(state.species,state.domestication);
    const actions=profile.capabilities.filter(action=>{
      if(action==='seek_mate')return state.ageDays>=life.adultAge&&!pregnant&&wildlifeBreedingAllowed(state);
      if(action==='migrate')return !domestication?.ownerId&&baseline&&state.ageDays>=life.adultAge*.4&&state.energy>30&&state.health>45&&!pregnant;
      if(action==='hunt')return isWildlifePredator(state.species);
      return true;
    });
    return [...new Set(actions)];
  }

  wildlifeMigrationCandidate(state:WildlifeState,chunk:CoarseChunkState):WildlifeMigrationCandidate {
    const population=chunk.wildlife?.find(entry=>entry.species===state.species);
    const carryingCapacity=Math.max(0,population?.carryingCapacity||0);
    const count=Math.max(0,population?.count||0);
    return {
      id:chunk.id,
      biome:chunk.biome,
      distance:dist(state.position,{x:chunk.cx*this.coarseWorld.chunkSize,z:chunk.cz*this.coarseWorld.chunkSize}),
      ecology:chunk.ecology,
      food:chunk.food,
      water:chunk.water,
      danger:chunk.danger,
      settlementLevel:chunk.settlementLevel,
      population:count,
      carryingCapacity,
      density:carryingCapacity>0?count/carryingCapacity:2,
      competitionPressure:population?.competitionPressure||0,
      seasonalSuitability:seasonalHabitatSuitability(chunk,state.species,this.day+this.minuteOfDay/1440),
      diseasePressure:chunk.wildlifeDisease?.speciesPressure[state.species]??population?.diseaseLoad??0
    };
  }

  wildlifeMigrationCandidates(state:WildlifeState) {
    const source=this.coarseWorld.chunks.get(state.chunkId);
    if(!source)return {current:undefined,nearby:[] as WildlifeMigrationCandidate[]};
    const current=this.wildlifeMigrationCandidate(state,source);
    const nearby=[...this.coarseWorld.chunks.values()]
      .filter(chunk=>areAdjacentChunks(source,chunk))
      .map(chunk=>this.wildlifeMigrationCandidate(state,chunk))
      .filter(candidate=>candidate.carryingCapacity>0&&candidate.population<candidate.carryingCapacity-.05)
      .sort((a,b)=>a.distance-b.distance||a.id.localeCompare(b.id));
    return {current,nearby};
  }

  wildlifeSnapshot(animal:WildlifeRuntime):WildlifeDecisionBatchRequest['requests'][number] {
    const migration=this.wildlifeMigrationCandidates(animal.state);
    const source=this.coarseWorld.chunks.get(animal.state.chunkId);
    const fallbackCurrent:WildlifeMigrationCandidate={
      id:animal.state.chunkId,biome:source?.biome||'plains',distance:0,
      ecology:source?.ecology||0,food:source?.food||0,water:source?.water||0,danger:source?.danger||100,
      settlementLevel:source?.settlementLevel||0,population:0,carryingCapacity:0,density:2,competitionPressure:0,
      seasonalSuitability:source?seasonalHabitatSuitability(source,animal.state.species,this.day+this.minuteOfDay/1440):0,
      diseasePressure:source?.wildlifeDisease?.speciesPressure[animal.state.species]??source?.wildlife?.find(x=>x.species===animal.state.species)?.diseaseLoad??0
    };
    const nearbyResources=[...this.objects.values()]
      .filter(o=>o.state.kind!=='dropped_item'&&o.mesh.visible&&dist(animal.state.position,o.state.position)<=12)
      .map(o=>({id:o.state.id,tags:o.state.tags,distance:dist(animal.state.position,o.state.position),resourceAmount:o.state.resourceAmount}))
      .sort((a,b)=>a.distance-b.distance).slice(0,16);
    const nearbyWildlife=[...this.wildlife.values()].filter(x=>x!==animal&&!x.removed)
      .map(x=>({
        id:x.state.id,species:x.state.species,sex:x.state.sex,ageDays:x.state.ageDays,
        distance:dist(animal.state.position,x.state.position),health:x.state.health,currentAction:x.state.currentAction,
        mateAvailable:x.state.ageDays>=this.wildlifeLifeHistory(x.state.species).adultAge
          &&!(x.state.sex==='female'&&x.state.pregnantUntilDay&&x.state.pregnantUntilDay>this.day+this.minuteOfDay/1440)
          &&wildlifePairBreedingAllowed(animal.state,x.state)
      }))
      .filter(x=>x.distance<=12).sort((a,b)=>a.distance-b.distance).slice(0,12);
    const decisionState=structuredClone(animal.state);
    decisionState.domestication=wildlifeDomesticationDecisionState(animal.state.species,animal.state.domestication);
    return {
      wildlife:decisionState,
      world:{
        gameTime:this.gameTimeText(),minuteOfDay:this.minuteOfDay,weather:this.weather,
        currentHabitat:migration.current||fallbackCurrent,nearbyChunks:migration.nearby,nearbyResources,nearbyWildlife
      },
      allowedActions:this.wildlifeAllowedActions(animal.state).filter(action=>{
        if(action==='drink')return nearbyResources.some(x=>x.tags.includes('water'));
        if(action==='hunt')return nearbyWildlife.some(x=>canWildlifePredate(animal.state.species,x.species));
        if(action==='seek_mate')return nearbyWildlife.some(x=>x.species===animal.state.species&&x.sex!==animal.state.sex&&x.mateAvailable);
        if(action==='flee')return nearbyWildlife.some(x=>canWildlifePredate(x.species,animal.state.species)&&x.distance<8);
        if(action==='migrate')return migration.nearby.length>0;
        return true;
      })
    };
  }

  async requestWildlifeBatch() {
    const due=[...this.wildlife.values()].filter(x=>!x.removed&&!wildlifeHasActiveOwnerCommand(x.state)&&now()>=x.nextDecisionAt)
      .sort((a,b)=>{
        const urgency=(x:WildlifeRuntime)=>Math.max(x.state.hunger,x.state.thirst,100-x.state.energy)+(100-x.state.health)*.5;
        return urgency(b)-urgency(a);
      }).slice(0,6);
    if(!due.length){this.nextWildlifeBatchAt=now()+1500;return;}
    this.wildlifeDecisionPending=true;
    const req:WildlifeDecisionBatchRequest={requests:due.map(x=>this.wildlifeSnapshot(x))};
    try{
      const response=await fetch('/api/wildlife/decide',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(req)});
      const out=await response.json() as WildlifeDecisionBatchResponse;
      if(!response.ok)throw new Error('wildlife decision failed');
      for(const decision of out.decisions){
        const animal=this.wildlife.get(decision.wildlifeId);
        if(animal&&!animal.removed)this.applyWildlifeDecision(animal,decision);
      }
    }catch{
      for(const animal of due)animal.nextDecisionAt=now()+5000+Math.random()*5000;
    }finally{
      this.wildlifeDecisionPending=false;
      this.nextWildlifeBatchAt=now()+2500;
    }
  }

  applyWildlifeDecision(animal:WildlifeRuntime,decision:WildlifeDecisionResult) {
    const s=animal.state;
    s.currentAction=decision.action;s.targetObjectId=decision.targetObjectId;s.targetWildlifeId=decision.targetWildlifeId;s.targetChunkId=decision.targetChunkId;s.lastDecisionAt=Date.now();
    animal.path=[];animal.pathIndex=0;animal.actionResolved=false;
    let target:Vec2|undefined;

    if(decision.action==='drink'||decision.action==='graze'||decision.action==='forage'){
      const chosen=decision.targetObjectId?this.objects.get(decision.targetObjectId):undefined;
      const object=chosen&&chosen.state.kind!=='dropped_item'&&chosen.mesh.visible
        ?chosen:this.findWildlifeResource(animal,decision.action);
      s.targetObjectId=object?.state.id;
      if(object)target=object.state.position;
    }else if(decision.action==='hunt'||decision.action==='seek_mate'){
      const other=(decision.targetWildlifeId&&this.wildlife.get(decision.targetWildlifeId))||this.findWildlifeTarget(animal,decision.action);
      if(other){s.targetWildlifeId=other.state.id;target=other.state.position;}
    }else if(decision.action==='flee'){
      const threat=(decision.targetWildlifeId&&this.wildlife.get(decision.targetWildlifeId))||this.findWildlifeTarget(animal,'flee');
      if(threat){
        const from=threat.state.position;
        let dx=s.position.x-from.x,dz=s.position.z-from.z;
        if(Math.hypot(dx,dz)<.1){dx=.7;dz=.7;}
        const length=Math.hypot(dx,dz);target=this.randomPassableNear({x:s.position.x+dx/length*8,z:s.position.z+dz/length*8},2,s.chunkId);
      }else{
        s.currentAction='wander';
        target=this.randomPassableNear(s.position,7,s.chunkId);
      }
    }else if(decision.action==='migrate'){
      const source=this.coarseWorld.chunks.get(s.chunkId);
      const candidates=this.wildlifeMigrationCandidates(s).nearby;
      const chosen=candidates.find(candidate=>candidate.id===decision.targetChunkId);
      const destination=chosen?this.coarseWorld.chunks.get(chosen.id):undefined;
      if(source&&destination){
        s.targetChunkId=destination.id;
        target=fineMigrationEntryPoint(source,destination,this.coarseWorld.chunkSize,s.position);
      }
      if(!target){s.currentAction='wander';s.targetChunkId=undefined;target=this.randomPassableNear(s.position,7,s.chunkId);}
    }else if(decision.action==='wander'){
      target=this.randomPassableNear(s.position,7,s.chunkId);
    }

    if(target)animal.path=this.findPath(s.position,target);
    if(!animal.path.length)this.completeWildlifeAction(animal);
  }

  findWildlifeResource(animal:WildlifeRuntime,action:WildlifeAction) {
    const candidates=[...this.objects.values()].filter(o=>o.state.kind!=='dropped_item'&&o.mesh.visible&&dist(animal.state.position,o.state.position)<=14);
    const forageTags=wildlifeSpeciesProfile(animal.state.species).forageTags;
    const genome=normalizeWildlifeOrganismGenome(animal.state.species,animal.state.organismGenome,animal.state.id);
    const wanted=(o:RuntimeObject)=>{
      if(action==='drink')return o.state.tags.includes('water')||o.state.kind==='well';
      if(action==='graze'||action==='forage'){
        return o.state.tags.some(tag=>forageTags.includes(tag))
          ||o.state.kind==='bush'||o.state.kind==='flower'
          ||(o.state.kind==='tree'&&o.state.tags.includes('apple'));
      }
      return false;
    };
    const eligible=candidates.filter(wanted);
    if(action==='graze'||action==='forage'){
      return eligible.sort((a,b)=>{
        const aScore=wildlifeResourceNicheScore(animal.state.species,genome,a.state.tags,dist(animal.state.position,a.state.position));
        const bScore=wildlifeResourceNicheScore(animal.state.species,genome,b.state.tags,dist(animal.state.position,b.state.position));
        return bScore-aScore||dist(animal.state.position,a.state.position)-dist(animal.state.position,b.state.position);
      })[0];
    }
    return eligible.sort((a,b)=>dist(animal.state.position,a.state.position)-dist(animal.state.position,b.state.position))[0];
  }

  findWildlifeTarget(animal:WildlifeRuntime,action:WildlifeAction) {
    const candidates=[...this.wildlife.values()].filter(x=>x!==animal&&!x.removed);
    if(action==='hunt')return candidates.filter(x=>canWildlifePredate(animal.state.species,x.state.species)).sort((a,b)=>dist(animal.state.position,a.state.position)-dist(animal.state.position,b.state.position))[0];
    if(action==='seek_mate')return candidates.filter(x=>x.state.species===animal.state.species&&x.state.sex!==animal.state.sex&&x.state.ageDays>=this.wildlifeLifeHistory(x.state.species).adultAge&&!(x.state.sex==='female'&&x.state.pregnantUntilDay&&x.state.pregnantUntilDay>this.day+this.minuteOfDay/1440)&&wildlifePairBreedingAllowed(animal.state,x.state)).sort((a,b)=>dist(animal.state.position,a.state.position)-dist(animal.state.position,b.state.position))[0];
    if(action==='flee')return candidates.filter(x=>canWildlifePredate(x.state.species,animal.state.species)).sort((a,b)=>dist(animal.state.position,a.state.position)-dist(animal.state.position,b.state.position))[0];
    return undefined;
  }

  completeWildlifeAction(animal:WildlifeRuntime) {
    const s=animal.state;
    const functional=wildlifeFunctionalPhenotype(normalizeWildlifePhenotype(s.phenotype,s.id));
    const object=s.targetObjectId?this.objects.get(s.targetObjectId):undefined;
    // Sealed inventory parcels are not exposed plants or water. A stale provider
    // target must not consume fractional parcel stock or grant a free need outcome.
    if(object?.state.kind==='dropped_item'&&['drink','graze','forage'].includes(s.currentAction)){
      s.targetObjectId=undefined;s.currentAction='rest';animal.actionResolved=true;return;
    }
    const other=s.targetWildlifeId?this.wildlife.get(s.targetWildlifeId):undefined;
    switch(s.currentAction){
      case 'drink':
        s.thirst=clamp(s.thirst-58,0,100);s.energy=clamp(s.energy-1,0,100);break;
      case 'graze':
      case 'forage': {
        const profile=wildlifeSpeciesProfile(s.species);
        const hungerRelief=(s.currentAction==='graze'?34:28)*functional.forageEfficiency;
        s.hunger=clamp(s.hunger-hungerRelief,0,100);
        if(object&&typeof object.state.resourceAmount==='number')object.state.resourceAmount=Math.max(0,object.state.resourceAmount-.25);
        else {
          const chunk=this.coarseWorld.chunks.get(s.chunkId);
          if(chunk?.plants){
            const genome=normalizeWildlifeOrganismGenome(s.species,s.organismGenome,s.id);
            const amount=.35,weights=wildlifeGenomePlantConsumptionWeights(s.species,genome);
            chunk.plants.grass=clamp(chunk.plants.grass-amount*weights.grass,0,100);
            chunk.plants.shrub=clamp(chunk.plants.shrub-amount*weights.shrub,0,100);
            chunk.plants.fruit=clamp(chunk.plants.fruit-amount*weights.fruit,0,100);
            chunk.plants.crop=clamp(chunk.plants.crop-amount*weights.crop,0,100);
          }
        }
        break;
      }
      case 'rest':
        s.energy=clamp(s.energy+24*functional.recoveryEfficiency,0,100);break;
      case 'flee': {
        const threatLineage=s.targetWildlifeId?this.wildlifeLineage.get(s.targetWildlifeId):undefined;
        const threatSpecies=other?.state.species||threatLineage?.species;
        const threatTraits=other?.state.traits||threatLineage?.traitsAtDeath||threatLineage?.traitsAtBirth;
        if(threatSpecies&&canWildlifePredate(threatSpecies,s.species)){
          const escaped=!other||other.removed||dist(s.position,other.state.position)>=6;
          recordWildlifeFleeOutcome(this.ensureWildlifeLineage(s),threatSpecies,escaped,s.traits,threatTraits);
          this.lineageEpoch++;
        }
        s.energy=clamp(s.energy-10*functional.fastActionEnergyMultiplier,0,100);break;
      }
      case 'hunt': {
        const preyLineage=s.targetWildlifeId?this.wildlifeLineage.get(s.targetWildlifeId):undefined;
        const preySpecies=other?.state.species||preyLineage?.species;
        const preyTraits=other?.state.traits||preyLineage?.traitsAtDeath||preyLineage?.traitsAtBirth;
        if(preySpecies&&canWildlifePredate(s.species,preySpecies)){
          let hit=false,kill=false;
          if(other&&!other.removed){
            const contact=resolveContactAttack(this.physics,{
              attackerId:`wildlife:${s.id}`,
              targetId:`wildlife:${other.state.id}`,
              start:{x:animal.mesh.position.x,z:animal.mesh.position.z},
              end:{x:other.mesh.position.x,z:other.mesh.position.z},
              maxRange:2.3,
              sweepRadius:.08,
              dynamic:this.physicsDynamicColliders(`wildlife:${s.id}`)
            });
            if(contact.status==='hit'){
              const damage=wildlifePredationDamage(s.species,other.state.species);
              const relief=wildlifeHungerRelief(s.species,other.state.species);
              other.state.health=clamp(other.state.health-damage,0,100);
              s.hunger=clamp(s.hunger-relief,0,100);
              s.energy=clamp(s.energy-wildlifeSpeciesProfile(s.species).huntEnergyCost*functional.fastActionEnergyMultiplier,0,100);
              hit=damage>0;
              kill=other.state.health<=0;
              if(hit){
                recordWildlifeAttackReceived(this.ensureWildlifeLineage(other.state),s.species,!kill,other.state.traits,s.traits);
                this.lineageEpoch++;
              }
            }
          }
          recordWildlifeHuntOutcome(this.ensureWildlifeLineage(s),preySpecies,hit,kill,s.traits,preyTraits);
          this.lineageEpoch++;
          if(kill&&other)this.removeWildlife(other,'predation');
        }
        break;
      }
      case 'seek_mate':
        if(other&&dist(s.position,other.state.position)<=2.5)this.tryWildlifeReproduction(animal,other);
        break;
      case 'migrate':
        if(s.targetChunkId&&this.completeFineWildlifeMigration(animal,s.targetChunkId))return;
        s.energy=clamp(s.energy-2*functional.fastActionEnergyMultiplier,0,100);
        break;
      case 'wander':
        s.energy=clamp(s.energy-2*functional.movementEnergyMultiplier,0,100);break;
    }
    animal.actionResolved=true;
    animal.nextDecisionAt=now()+8000+Math.random()*10000;
    s.targetObjectId=undefined;s.targetWildlifeId=undefined;s.targetChunkId=undefined;
  }

  transferOwnedFollowersToChunk(sourceChunkId:string,target:CoarseChunkState) {
    if(this.cameraMode!=='firstPerson')return;
    const source=this.coarseWorld.chunks.get(sourceChunkId);
    const runtime=this.materializedChunks.get(sourceChunkId);
    if(!source||!runtime||!areAdjacentChunks(source,target))return;
    const followers=runtime.wildlifeIds
      .map(id=>this.wildlife.get(id))
      .filter((animal):animal is WildlifeRuntime=>Boolean(animal&&!animal.removed))
      .filter(animal=>{
        const d=normalizeWildlifeDomestication(animal.state.species,animal.state.domestication);
        return d?.ownerId==='player'&&d.command==='follow';
      });
    for(const animal of followers){
      const entry=fineMigrationEntryPoint(source,target,this.coarseWorld.chunkSize,animal.state.position);
      this.completeFineWildlifeMigration(animal,target.id,'owner_follow',entry);
    }
  }

  completeFineWildlifeMigration(
    animal:WildlifeRuntime,
    targetChunkId:string,
    reason:'behavioral_migration'|'owner_follow'='behavioral_migration',
    committedEntry?:Vec2
  ) {
    if(animal.removed||this.wildlifeTransfers.has(animal.state.id))return false;
    const state=animal.state;
    const source=this.coarseWorld.chunks.get(state.chunkId);
    const target=this.coarseWorld.chunks.get(targetChunkId);
    const sourceRuntime=this.materializedChunks.get(state.chunkId);
    if(!source||!target||!sourceRuntime||!areAdjacentChunks(source,target))return false;

    const sourcePopulation=source.wildlife?.find(population=>population.species===state.species);
    const targetPopulation=target.wildlife?.find(population=>population.species===state.species);
    if(!sourcePopulation||!targetPopulation)return false;

    const fixedWeight=sourceRuntime.fixedWildlifeWeights.get(state.id)||state.representedPopulation||0;
    const initialFineCount=sourceRuntime.initialWildlifeCounts[state.species]||0;
    let sourceFixedTotal=0;
    for(const [id,weight] of sourceRuntime.fixedWildlifeWeights){
      if(this.wildlifeLineage.get(id)?.species===state.species)sourceFixedTotal+=weight;
    }
    const ordinaryWeight=foldFineWildlifePopulationCount(
      sourcePopulation.count,initialFineCount,initialFineCount,sourceFixedTotal,sourceFixedTotal
    ).ordinaryWeight;
    const requestedWeight=fixedWeight>0?fixedWeight:ordinaryWeight;
    const freeCapacity=Math.max(0,targetPopulation.carryingCapacity-targetPopulation.count);
    if(freeCapacity<=.05)return false;

    state.position={x:animal.mesh.position.x,z:animal.mesh.position.z};
    this.endWildlifeHabitatObservation(state);
    const representedPopulation=applyFineWildlifePopulationTransfer(
      sourcePopulation,targetPopulation,state,initialFineCount,requestedWeight,freeCapacity
    );
    if(representedPopulation<=0){this.beginWildlifeHabitatObservation(state);return false;}
    if(committedEntry){
      state.position={...committedEntry};
      animal.mesh.position.set(committedEntry.x,0,committedEntry.z);
    }

    sourceRuntime.wildlifeIds=sourceRuntime.wildlifeIds.filter(id=>id!==state.id);
    sourceRuntime.initialWildlifeIds.delete(state.id);
    if(fixedWeight>0)sourceRuntime.fixedWildlifeWeights.delete(state.id);
    else sourceRuntime.initialWildlifeCounts[state.species]=Math.max(0,initialFineCount-1);
    const currentDay=this.day+this.minuteOfDay/1440;
    const lineage=this.ensureWildlifeLineage(state);
    lineage.migrationHistory??=[];
    lineage.migrationHistory.push({
      fromChunkId:source.id,toChunkId:target.id,day:currentDay,
      fromBiome:source.biome,toBiome:target.biome,representedPopulation,reason
    });
    if(lineage.habitatExposure){
      lineage.habitatExposure.observedTransitions++;
      lineage.habitatExposure.lastChunk=target.id;
      lineage.habitatExposure.lastBiome=target.biome;
      lineage.habitatExposure.lastObservedDay=undefined;
    }
    this.lineageEpoch++;

    const transferredState=structuredClone(state);
    transferredState.chunkId=target.id;
    transferredState.position={x:animal.mesh.position.x,z:animal.mesh.position.z};
    const migrationFunction=wildlifeFunctionalPhenotype(normalizeWildlifePhenotype(state.phenotype,state.id));
    transferredState.energy=clamp(transferredState.energy-10*migrationFunction.fastActionEnergyMultiplier,0,100);
    transferredState.representedPopulation=representedPopulation;
    transferredState.currentAction='wander';
    transferredState.targetObjectId=undefined;
    transferredState.targetWildlifeId=undefined;
    transferredState.targetChunkId=undefined;
    const transfer:PersistedWildlifeTransfer={
      entityId:state.id,state:transferredState,fromChunkId:source.id,toChunkId:target.id,
      representedPopulation,transferredDay:currentDay
    };

    animal.removed=true;
    animal.path=[];animal.pathIndex=0;
    this.wildlifePresentation.remove(animal);
    animal.mesh.parent?.remove(animal.mesh);
    this.wildlife.delete(state.id);

    const targetRuntime=this.materializedChunks.get(target.id);
    if(targetRuntime){
      if(this.spawnWildlife(structuredClone(transferredState))){
        targetRuntime.wildlifeIds.push(state.id);
        targetRuntime.initialWildlifeIds.add(state.id);
        targetRuntime.fixedWildlifeWeights.set(state.id,representedPopulation);
      }else this.wildlifeTransfers.set(state.id,transfer);
    }else this.wildlifeTransfers.set(state.id,transfer);
    if(this.selectedEntity?.type==='wildlife'&&this.selectedEntity.id===state.id)this.selectedEntity=undefined;
    if(this.hoverEntity?.type==='wildlife'&&this.hoverEntity.id===state.id)this.hoverEntity=undefined;
    this.event(`${this.wildlifeName(state.species)} ${state.id} 从 ${source.id} 迁移至 ${target.id}（代表 ${representedPopulation.toFixed(2)} · ${reason}）`);
    this.log(`Wildlife migration ${state.id}: ${source.id} -> ${target.id} amount=${representedPopulation.toFixed(3)} reason=${reason}`);
    return true;
  }
  tryWildlifeReproduction(a:WildlifeRuntime,b:WildlifeRuntime) {
    if(a.state.species!==b.state.species||a.state.sex===b.state.sex||!wildlifePairBreedingAllowed(a.state,b.state))return;
    const mother=a.state.sex==='female'?a:b;
    const father=mother===a?b:a;
    const life=this.wildlifeLifeHistory(mother.state.species);
    const currentDay=this.day+this.minuteOfDay/1440;
    if(mother.state.ageDays<life.adultAge||father.state.ageDays<life.adultAge||mother.state.health<60||father.state.health<60||mother.state.hunger>70||mother.state.thirst>70)return;
    if(mother.state.pregnantUntilDay&&mother.state.pregnantUntilDay>currentDay)return;
    if(mother.state.lastBirthDay&&currentDay-mother.state.lastBirthDay<life.birthCooldown)return;
    const chunk=this.coarseWorld.chunks.get(mother.state.chunkId);
    const population=chunk?.wildlife?.find(x=>x.species===mother.state.species);
    const current=[...this.wildlife.values()].filter(x=>x.state.chunkId===mother.state.chunkId&&x.state.species===mother.state.species&&!x.removed).length;
    if(population&&current>=Math.max(2,Math.ceil(population.carryingCapacity*.45)))return;
    const fertility=(mother.state.traits.fertility+father.state.traits.fertility)/2;
    if(!this.deterministicChance(`${mother.state.id}:${father.state.id}:${this.day}:${Math.floor(this.minuteOfDay/30)}`,fertility*.22))return;
    mother.state.pregnantById=father.state.id;
    mother.state.pregnantUntilDay=currentDay+life.gestationDays;
    mother.state.energy=clamp(mother.state.energy-8,0,100);
    this.event(`${this.wildlifeName(mother.state.species)}进入妊娠期。`);
  }

  maybeCompleteWildlifePregnancy(mother:WildlifeRuntime) {
    const s=mother.state;
    if(s.sex!=='female'||!s.pregnantUntilDay||!s.pregnantById)return;
    const currentDay=this.day+this.minuteOfDay/1440;
    if(currentDay<s.pregnantUntilDay)return;
    const father=this.wildlife.get(s.pregnantById);
    const fatherState=father?.state;
    const fatherLineage=this.wildlifeLineage.get(s.pregnantById);
    const life=this.wildlifeLifeHistory(s.species);
    const population=this.coarseWorld.chunks.get(s.chunkId)?.wildlife?.find(x=>x.species===s.species);
    const current=[...this.wildlife.values()].filter(x=>x.state.chunkId===s.chunkId&&x.state.species===s.species&&!x.removed).length;
    const room=population?Math.max(0,Math.ceil(population.carryingCapacity*.45)-current):life.litterMax;
    const litter=Math.min(room,life.litterMin+Math.floor(this.deterministicUnit(`${s.id}:litter:${this.day}`)*(life.litterMax-life.litterMin+1)));
    const fatherTraits=fatherState?.traits??fatherLineage?.traitsAtDeath??fatherLineage?.traitsAtBirth??s.traits;
    const motherPhenotype=normalizeWildlifePhenotype(s.phenotype,s.id);
    s.phenotype=motherPhenotype;
    const fatherPhenotype=fatherState
      ?normalizeWildlifePhenotype(fatherState.phenotype,fatherState.id)
      :(fatherLineage?.phenotypeAtDeath??fatherLineage?.phenotypeAtBirth??motherPhenotype);
    const motherGenome=normalizeWildlifeOrganismGenome(s.species,s.organismGenome,s.id);
    s.organismGenome=motherGenome;
    const fatherGenome=fatherState
      ?normalizeWildlifeOrganismGenome(fatherState.species,fatherState.organismGenome,fatherState.id)
      :(fatherLineage?.organismGenomeAtDeath??fatherLineage?.organismGenomeAtBirth??motherGenome);
    const fatherGeneration=fatherState?.generation??fatherLineage?.generation??s.generation;
    for(let i=0;i<litter;i++){
      const generation=Math.max(s.generation,fatherGeneration)+1;
      const id=`${s.chunkId}_wild_${s.species}_g${generation}_${this.day}_${Math.floor(this.minuteOfDay)}_${i}_${this.wildlife.size}`;
      const traits={
        speed:this.inheritTrait(s.traits.speed,fatherTraits.speed,`${id}:speed`),
        size:this.inheritTrait(s.traits.size,fatherTraits.size,`${id}:size`),
        fertility:clamp(this.inheritTrait(s.traits.fertility,fatherTraits.fertility,`${id}:fertility`),.15,1),
        wariness:clamp(this.inheritTrait(s.traits.wariness,fatherTraits.wariness,`${id}:wariness`),.1,1)
      };
      const phenotype=inheritWildlifePhenotype(motherPhenotype,fatherPhenotype,id);
      const organismGenome=inheritWildlifeOrganismGenome(s.species,motherGenome,fatherGenome,id);
      const fatherDomestication=fatherState?.domestication??fatherLineage?.domesticationAtDeath??fatherLineage?.domesticationAtBirth;
      const domestication=inheritedWildlifeDomestication(s.species,s.domestication,fatherDomestication,currentDay);
      const baby:WildlifeState={
        id,chunkId:s.chunkId,species:s.species,position:{x:s.position.x+(i+1)*.18,z:s.position.z+(i%2?-.2:.2)},
        ageDays:0,health:88,hunger:15,thirst:15,energy:84,sex:this.deterministicChance(id+':sex',.5)?'female':'male',
        generation,traits,phenotype,organismGenome,domestication,currentAction:'rest',lastDecisionAt:Date.now(),birthDay:currentDay,
        diseaseLoad:Math.max(0,((s.diseaseLoad||0)+(fatherState?.diseaseLoad||0))*.12),motherId:s.id,fatherId:fatherState?.id??fatherLineage?.entityId??s.pregnantById
      };
      if(this.spawnWildlife(baby)){
        const runtime=this.materializedChunks.get(s.chunkId);if(runtime)runtime.wildlifeIds.push(id);
        this.recordWildlifeOffspring(s.id);
        this.recordWildlifeOffspring(baby.fatherId);
      }
    }
    s.pregnantById=undefined;s.pregnantUntilDay=undefined;s.lastBirthDay=currentDay;
    s.energy=clamp(s.energy-18,0,100);s.hunger=clamp(s.hunger+16,0,100);
    if(litter>0)this.event(`${this.wildlifeName(s.species)}诞生了 ${litter} 只第 ${Math.max(s.generation,fatherGeneration)+1} 代幼体。`);
  }

  wildlifeLifeHistory(species:WildlifeSpecies) {
    return getWildlifeLifeHistory(species);
  }

  deterministicUnit(key:string) {
    let h=2166136261;
    for(let i=0;i<key.length;i++){h^=key.charCodeAt(i);h=Math.imul(h,16777619);}
    return (h>>>0)/4294967295;
  }

  deterministicChance(key:string,threshold:number) {
    let h=2166136261;
    for(let i=0;i<key.length;i++){h^=key.charCodeAt(i);h=Math.imul(h,16777619);}
    return (h>>>0)/4294967295<clamp(threshold,0,1);
  }

  inheritTrait(a:number,b:number,key:string) {
    let h=2166136261;
    for(let i=0;i<key.length;i++){h^=key.charCodeAt(i);h=Math.imul(h,16777619);}
    const mutation=((h>>>0)/4294967295-.5)*.10;
    return ((a+b)/2)*(1+mutation);
  }

  wildlifeHabitatSnapshot(chunkId:string,species?:WildlifeSpecies) {
    const chunk=this.coarseWorld.chunks.get(chunkId);
    if(!chunk)return undefined;
    const plants=chunk.plants;
    const population=species?chunk.wildlife?.find(entry=>entry.species===species):undefined;
    return {
      biome:chunk.biome,
      ecology:chunk.ecology,
      food:chunk.food,
      water:chunk.water,
      danger:chunk.danger,
      settlementLevel:chunk.settlementLevel,
      plantBiomass:plants?(plants.grass+plants.shrub+plants.fruit+plants.crop)/4:chunk.ecology,
      competitionPressure:population?.competitionPressure||0,
      seasonalSuitability:species?seasonalHabitatSuitability(chunk,species,this.day+this.minuteOfDay/1440):0,
      diseasePressure:species?(chunk.wildlifeDisease?.speciesPressure[species]??population?.diseaseLoad??0):0,
      predatorPressure:species?(chunk.wildlifePredatorPressure?.speciesPressure[species]??population?.predatorPressure??0):0
    };
  }

  wildlifePredatorSourcePressure(chunkId:string,preySpecies:WildlifeSpecies) {
    const pressure=this.coarseWorld.chunks.get(chunkId)?.wildlifePredatorPressure;
    if(!pressure?.pairs)return undefined;
    const out:Partial<Record<WildlifeSpecies,number>>={};
    for(const predatorSpecies of WILDLIFE_SPECIES){
      if(!canWildlifePredate(predatorSpecies,preySpecies))continue;
      out[predatorSpecies]=pressure.pairs?.find(pair=>pair.predatorSpecies===predatorSpecies&&pair.preySpecies===preySpecies)?.pressure||0;
    }
    return Object.keys(out).length?out:undefined;
  }

  wildlifeCompetitionSourcePressure(chunkId:string,species:WildlifeSpecies) {
    const competition=this.coarseWorld.chunks.get(chunkId)?.nicheCompetition;
    if(!competition?.pairs)return undefined;
    const out:Partial<Record<WildlifeSpecies,number>>={};
    for(const sourceSpecies of WILDLIFE_SPECIES){
      if(sourceSpecies===species)continue;
      out[sourceSpecies]=competition.pairs.find(pair=>
        (pair.speciesA===species&&pair.speciesB===sourceSpecies)||(pair.speciesB===species&&pair.speciesA===sourceSpecies)
      )?.pressure||0;
    }
    return out;
  }

  wildlifeDiseaseSourcePressure(chunkId:string,species:WildlifeSpecies) {
    const disease=this.coarseWorld.chunks.get(chunkId)?.wildlifeDisease;
    if(!disease?.pairs)return undefined;
    const out:Partial<Record<WildlifeSpecies,number>>={};
    for(const sourceSpecies of WILDLIFE_SPECIES){
      if(sourceSpecies===species)continue;
      out[sourceSpecies]=disease.pairs.find(pair=>pair.fromSpecies===sourceSpecies&&pair.toSpecies===species)?.pressure||0;
    }
    return out;
  }

  flushWildlifeHabitatExposure() {
    for(const animal of this.wildlife.values()){
      if(!animal.removed)this.recordWildlifeHabitatExposure(animal.state,true);
    }
  }

  beginWildlifeHabitatObservation(state:WildlifeState) {
    const record=this.ensureWildlifeLineage(state);
    const habitat=this.wildlifeHabitatSnapshot(state.chunkId,state.species);
    if(!habitat)return;
    const exposure=accumulateWildlifeHabitatExposure(
      record.habitatExposure,habitat,state.chunkId,0,
      this.wildlifePredatorSourcePressure(state.chunkId,state.species),
      this.wildlifeCompetitionSourcePressure(state.chunkId,state.species),
      this.wildlifeDiseaseSourcePressure(state.chunkId,state.species)
    );
    exposure.lastObservedDay=this.day+this.minuteOfDay/1440;
    exposure.lastChunk=state.chunkId;
    exposure.lastBiome=habitat.biome;
    record.habitatExposure=exposure;
  }

  recordWildlifeHabitatExposure(state:WildlifeState,force=false) {
    const record=this.ensureWildlifeLineage(state);
    const habitat=this.wildlifeHabitatSnapshot(state.chunkId,state.species);
    if(!habitat)return;
    const currentDay=this.day+this.minuteOfDay/1440;
    if(!record.habitatExposure||record.habitatExposure.lastObservedDay===undefined){
      this.beginWildlifeHabitatObservation(state);
      return;
    }
    const elapsed=Math.max(0,currentDay-record.habitatExposure.lastObservedDay);
    const sameChunk=record.habitatExposure.lastChunk===state.chunkId;
    if(elapsed<=0||(!force&&sameChunk&&elapsed<.02))return;
    const exposure=accumulateWildlifeHabitatExposure(
      record.habitatExposure,habitat,state.chunkId,elapsed,
      this.wildlifePredatorSourcePressure(state.chunkId,state.species),
      this.wildlifeCompetitionSourcePressure(state.chunkId,state.species),
      this.wildlifeDiseaseSourcePressure(state.chunkId,state.species)
    );
    exposure.lastObservedDay=currentDay;
    record.habitatExposure=exposure;
    this.lineageEpoch++;
  }

  endWildlifeHabitatObservation(state:WildlifeState) {
    this.recordWildlifeHabitatExposure(state,true);
    const exposure=this.wildlifeLineage.get(state.id)?.habitatExposure;
    if(exposure)exposure.lastObservedDay=undefined;
  }

  ensureWildlifeLineage(state:WildlifeState) {
    const existing=this.wildlifeLineage.get(state.id);
    if(existing){
      let changed=false;
      if(!existing.birthHabitat){
        existing.birthHabitat=this.wildlifeHabitatSnapshot(existing.birthChunk||state.chunkId,existing.species);
        changed=Boolean(existing.birthHabitat);
      }
      if(!existing.phenotypeAtBirth&&state.phenotype){
        existing.phenotypeAtBirth=structuredClone(state.phenotype);
        existing.phenotypeProvenance='legacy_upgrade';
        changed=true;
      }
      if(!existing.organismGenomeAtBirth&&state.organismGenome){
        existing.organismGenomeAtBirth=structuredClone(state.organismGenome);
        existing.organismGenomeProvenance='legacy_upgrade';
        changed=true;
      }
      if(changed)this.lineageEpoch++;
      return existing;
    }
    const record:WildlifeLineageRecord={
      entityId:state.id,
      species:state.species,
      motherId:state.motherId,
      fatherId:state.fatherId,
      birthDay:state.birthDay,
      generation:state.generation,
      birthChunk:state.chunkId,
      traitsAtBirth:structuredClone(state.traits),
      phenotypeAtBirth:state.phenotype?structuredClone(state.phenotype):undefined,
      phenotypeProvenance:state.phenotype?(state.motherId||state.fatherId?'birth':'founder_seed'):undefined,
      organismGenomeAtBirth:state.organismGenome?structuredClone(state.organismGenome):undefined,
      organismGenomeProvenance:state.organismGenome?(state.motherId||state.fatherId?'birth':'founder_seed'):undefined,
      domesticationAtBirth:state.domestication&&state.motherId?structuredClone(state.domestication):undefined,
      birthHabitat:this.wildlifeHabitatSnapshot(state.chunkId,state.species),
      origin:state.motherId||state.fatherId?'reproduction':'founder',
      offspringCount:0,
      reproductiveSuccess:false
    };
    this.wildlifeLineage.set(record.entityId,record);
    this.lineageEpoch++;
    return record;
  }

  recordWildlifeOffspring(parentId?:string) {
    if(!parentId)return;
    const parent=this.wildlifeLineage.get(parentId);
    if(!parent)return;
    parent.offspringCount++;
    parent.reproductiveSuccess=true;
    this.lineageEpoch++;
  }

  reconcileLineageOffspring() {
    const counts=new Map<string,number>();
    for(const record of this.wildlifeLineage.values()){
      if(record.motherId)counts.set(record.motherId,(counts.get(record.motherId)||0)+1);
      if(record.fatherId)counts.set(record.fatherId,(counts.get(record.fatherId)||0)+1);
    }
    let changed=false;
    for(const record of this.wildlifeLineage.values()){
      const known=counts.get(record.entityId)||0;
      if(known>record.offspringCount){
        record.offspringCount=known;
        record.reproductiveSuccess=known>0;
        changed=true;
      }
    }
    if(changed)this.lineageEpoch++;
  }

  classifyWildlifeDeath(state:WildlifeState):WildlifeDeathReason {
    if(state.hunger>=95&&state.hunger>=state.thirst)return 'starvation';
    if(state.thirst>=95)return 'dehydration';
    if((state.diseaseLoad||0)>=60)return 'disease';
    if(state.ageDays>=this.wildlifeLifeHistory(state.species).maxAge*.72)return 'senescence';
    return 'other';
  }

  removeWildlife(animal:WildlifeRuntime,reason:WildlifeDeathReason) {
    if(animal.removed)return;
    this.recordWildlifeHabitatExposure(animal.state,true);
    const currentDay=this.day+this.minuteOfDay/1440;
    const record=this.ensureWildlifeLineage(animal.state);
    if(record.deathDay===undefined){
      record.deathDay=currentDay;
      record.deathReason=reason;
      record.deathChunk=animal.state.chunkId;
      record.traitsAtDeath=structuredClone(animal.state.traits);
      record.phenotypeAtDeath=animal.state.phenotype?structuredClone(animal.state.phenotype):record.phenotypeAtBirth?structuredClone(record.phenotypeAtBirth):undefined;
      record.organismGenomeAtDeath=animal.state.organismGenome?structuredClone(animal.state.organismGenome):record.organismGenomeAtBirth?structuredClone(record.organismGenomeAtBirth):undefined;
      record.domesticationAtDeath=animal.state.domestication?structuredClone(animal.state.domestication):undefined;
      record.deathHabitat=this.wildlifeHabitatSnapshot(animal.state.chunkId,animal.state.species);
      if(record.habitatExposure)record.habitatExposure.lastObservedDay=undefined;
      this.lineageEpoch++;
    }
    animal.removed=true;this.wildlifePresentation.remove(animal);animal.mesh.parent?.remove(animal.mesh);this.wildlife.delete(animal.state.id);
    this.event(`${this.wildlifeName(animal.state.species)} ${animal.state.id} ${i18n.t(`evolution.death.${reason}`)}。`);
  }

  evolutionStatistics() {
    const currentDay=this.day+this.minuteOfDay/1440;
    const eligibilityDay=Math.floor(currentDay);
    if(this.evolutionCacheEpoch!==this.lineageEpoch||this.evolutionCacheDay!==eligibilityDay){
      this.evolutionCache=computeEvolutionStatistics(this.wildlifeLineage.values(),currentDay);
      this.evolutionCacheEpoch=this.lineageEpoch;
      this.evolutionCacheDay=eligibilityDay;
    }
    return this.evolutionCache;
  }

  coevolutionStatistics() {
    const currentDay=this.day+this.minuteOfDay/1440;
    const eligibilityDay=Math.floor(currentDay);
    if(this.coevolutionCacheEpoch!==this.lineageEpoch||this.coevolutionCacheDay!==eligibilityDay){
      this.coevolutionCache=computeWildlifeCoevolutionEvidence(this.wildlifeLineage.values(),currentDay);
      this.coevolutionCacheEpoch=this.lineageEpoch;
      this.coevolutionCacheDay=eligibilityDay;
    }
    return this.coevolutionCache;
  }

  interactionSelectionStatistics() {
    const currentDay=this.day+this.minuteOfDay/1440;
    const eligibilityDay=Math.floor(currentDay);
    if(this.interactionSelectionCacheEpoch!==this.lineageEpoch||this.interactionSelectionCacheDay!==eligibilityDay){
      this.interactionSelectionCache=computeWildlifeInteractionSelectionEvidence(this.wildlifeLineage.values(),currentDay);
      this.interactionSelectionCacheEpoch=this.lineageEpoch;
      this.interactionSelectionCacheDay=eligibilityDay;
    }
    return this.interactionSelectionCache;
  }

  wildlifeName(species:WildlifeSpecies) {
    return i18n.t(`wildlife.${species}`);
  }

  activeInteractionNetwork() {
    const current=now();
    if(!this.interactionNetworkCache||current-this.interactionNetworkCacheAt>1000){
      const chunks=[...this.coarseWorld.activeChunkIds]
        .map(id=>this.coarseWorld.chunks.get(id))
        .filter((chunk):chunk is CoarseChunkState=>Boolean(chunk));
      this.interactionNetworkCache=computeWildlifeInteractionNetwork(chunks);
      this.interactionNetworkCacheAt=current;
    }
    return this.interactionNetworkCache;
  }

  renderInteractionNetworkEvidence(network:WildlifeInteractionNetwork) {
    const edgeLabel=(edge:WildlifeInteractionNetwork['edges'][number])=>{
      const arrow=edge.directed?'→':'↔';
      return `${this.escape(this.wildlifeName(edge.fromSpecies))} ${arrow} ${this.escape(this.wildlifeName(edge.toSpecies))} ${edge.meanPressure.toFixed(1)} (max ${edge.maxPressure.toFixed(1)}, ${edge.activeChunks}/${edge.coverageChunks})`;
    };
    const top=network.edges.slice().sort((a,b)=>b.meanPressure-a.meanPressure||b.maxPressure-a.maxPressure).slice(0,8);
    const nodes=network.nodes.slice().sort((a,b)=>
      (b.predationIncoming+b.predationOutgoing+b.competitionPressure+b.diseaseIncoming+b.diseaseOutgoing)-
      (a.predationIncoming+a.predationOutgoing+a.competitionPressure+a.diseaseIncoming+a.diseaseOutgoing)
    ).slice(0,6);
    return `<div class="evo-lineage"><b>${i18n.t('evolution.interactionNetwork')}</b> · active chunks ${network.chunks} · coverage P/C/D ${network.coverage.predation}/${network.coverage.competition}/${network.coverage.disease}
      ${top.length?`<div class="evo-traits">${top.map(edge=>`${i18n.t(`evolution.interaction.${edge.kind}`)}: ${edgeLabel(edge)}`).join('<br>')}</div>`:''}
      ${nodes.length?`<div class="evo-traits">${nodes.map(node=>`${this.escape(this.wildlifeName(node.species))} n~${node.population.toFixed(1)} · pred in/out ${node.predationIncoming.toFixed(1)}/${node.predationOutgoing.toFixed(1)} · comp ${node.competitionPressure.toFixed(1)} · disease in/out ${node.diseaseIncoming.toFixed(1)}/${node.diseaseOutgoing.toFixed(1)}`).join('<br>')}</div>`:''}
    </div>`;
  }

  renderInteractionSelectionSideEvidence(side:WildlifeInteractionSourceGenerationEvidence) {
    const number=(value:number|null,digits=2)=>value===null?'—':value.toFixed(digits);
    const percent=(value:number)=>`${(value*100).toFixed(0)}%`;
    const recent=side.generations.slice(-4);
    return `<div class="evo-traits"><b>${this.escape(this.wildlifeName(side.targetSpecies))} ← ${this.escape(this.wildlifeName(side.sourceSpecies))}</b> · G=${side.generationsObserved} · n=${side.observedIndividuals}<br>
      Δ/G pressure ${number(side.pressureTrendPerGeneration)} · breeder ${number(side.breederTrendPerGeneration)} · offspring ${number(side.offspringTrendPerGeneration)} · lifespan ${number(side.lifespanTrendPerGeneration)}<br>
      r(pressure, breeder) ${number(side.pressureBreederAssociation)} · r(pressure, offspring) ${number(side.pressureOffspringAssociation)} · r(pressure, lifespan) ${number(side.pressureLifespanAssociation)}<br>
      trait Δ/G speed ${number(side.traitTrendPerGeneration.speed)} · size ${number(side.traitTrendPerGeneration.size)} · fertility ${number(side.traitTrendPerGeneration.fertility)} · wariness ${number(side.traitTrendPerGeneration.wariness)}<br>
      r(pressure, speed) ${number(side.pressureTraitAssociation.speed)} · size ${number(side.pressureTraitAssociation.size)} · wariness ${number(side.pressureTraitAssociation.wariness)}
      ${recent.length?`<br>${i18n.t('evolution.generationTrend')} ${recent.map(g=>`G${g.generation} p ${g.pressureMean.toFixed(1)} breeder ${g.eligibleIndividuals?percent(g.breederRate):'—'} off ${g.eligibleIndividuals?g.offspringMean.toFixed(2):'—'} life ${g.deaths?g.lifespanMean.toFixed(1):'—'}`).join(' · ')}`:''}
    </div>`;
  }

  renderInteractionSelectionPairEvidence(pair:WildlifeReciprocalInteractionSelectionEvidence) {
    return `<div class="evo-lineage"><b>${i18n.t('evolution.interactionSelection')} · ${i18n.t(`evolution.interaction.${pair.kind}`)} · ${this.escape(this.wildlifeName(pair.speciesA))} ↔ ${this.escape(this.wildlifeName(pair.speciesB))}</b> · ${pair.bothSidesObserved?i18n.t('evolution.bilateralEvidence'):i18n.t('evolution.partialEvidence')}
      ${this.renderInteractionSelectionSideEvidence(pair.sideA)}
      ${this.renderInteractionSelectionSideEvidence(pair.sideB)}
    </div>`;
  }

  renderCoevolutionSideEvidence(side:WildlifeCoevolutionSideEvidence) {
    const number=(value:number|null,digits=2)=>value===null?'—':value.toFixed(digits);
    const percent=(value:number)=>`${(value*100).toFixed(0)}%`;
    const trait=(value:number|null)=>value===null?'—':value.toFixed(2);
    const recent=side.generations.filter(g=>g.attempts>0||g.terminalAttempts>0).slice(-4);
    const roleLabel=side.role==='predator'?i18n.t('evolution.asPredator'):i18n.t('evolution.asPrey');
    const performanceLabel=side.role==='predator'?'hit':'escape';
    const terminalLabel=side.role==='predator'?'kill':'survive';
    return `<div class="evo-traits"><b>${roleLabel} · ${this.escape(this.wildlifeName(side.species))}</b> · G=${side.generationsObserved} · n=${side.interactingIndividuals}<br>
      Δ/G ${performanceLabel} ${number(side.performanceTrendPerGeneration)} · ${terminalLabel} ${number(side.terminalPerformanceTrendPerGeneration)} · breeder ${number(side.breederTrendPerGeneration)} · offspring ${number(side.offspringTrendPerGeneration)}<br>
      r(${performanceLabel}, breeder) ${number(side.performanceBreederAssociation)} · r(${terminalLabel}, breeder) ${number(side.terminalPerformanceBreederAssociation)} · r(${performanceLabel}, offspring) ${number(side.performanceOffspringAssociation)} · r(${terminalLabel}, offspring) ${number(side.terminalPerformanceOffspringAssociation)}<br>
      trait Δ/G speed ${trait(side.traitTrendPerGeneration.speed)} · size ${trait(side.traitTrendPerGeneration.size)} · fertility ${trait(side.traitTrendPerGeneration.fertility)} · wariness ${trait(side.traitTrendPerGeneration.wariness)}<br>
      r(${performanceLabel}, speed) ${trait(side.performanceTraitAssociation.speed)} · r(${terminalLabel}, size) ${trait(side.terminalPerformanceTraitAssociation.size)} · r(${performanceLabel}, wariness) ${trait(side.performanceTraitAssociation.wariness)}
      ${recent.length?`<br>${i18n.t('evolution.generationTrend')} ${recent.map(g=>`G${g.generation} ${performanceLabel} ${percent(g.successRate)} ${terminalLabel} ${percent(g.terminalSuccessRate)} breeder ${g.eligibleIndividuals?percent(g.breederRate):'—'} off ${g.eligibleIndividuals?g.offspringMean.toFixed(2):'—'}`).join(' · ')}`:''}
    </div>`;
  }

  renderCoevolutionPairEvidence(pair:WildlifeCoevolutionPairEvidence) {
    return `<div class="evo-lineage"><b>${i18n.t('evolution.coevolutionEvidence')} · ${this.escape(this.wildlifeName(pair.predatorSpecies))} → ${this.escape(this.wildlifeName(pair.preySpecies))}</b> · ${pair.bothSidesObserved?i18n.t('evolution.bilateralEvidence'):i18n.t('evolution.partialEvidence')}
      ${this.renderCoevolutionSideEvidence(pair.predator)}
      ${this.renderCoevolutionSideEvidence(pair.prey)}
    </div>`;
  }

  renderPredationPairEvidence(pair:WildlifePredationPairPerformance) {
    const trait=(value:number)=>Number.isFinite(value)?value.toFixed(2):'0.00';
    const association=(value:number|null)=>value===null?'—':value.toFixed(2);
    const percent=(value:number)=>`${(value*100).toFixed(0)}%`;
    const generations=pair.generationTrend.filter(g=>g.attempts>0||g.terminalAttempts>0).slice(-3);
    const generationText=generations.length
      ?`<br>${i18n.t('evolution.generationTrend')} ${generations.map(g=>pair.role==='predator'
        ?`G${g.generation} hit ${percent(g.successRate)} kill ${percent(g.terminalSuccessRate)} Δv ${trait(g.successTraitAdvantageMean.speed)}`
        :`G${g.generation} escape ${percent(g.successRate)} survive ${percent(g.terminalSuccessRate)} Δv ${trait(g.successTraitAdvantageMean.speed)}`
      ).join(' · ')}`
      :'';
    if(pair.role==='predator'){
      return `<div class="evo-traits">${i18n.t('evolution.asPredator')} → ${this.escape(this.wildlifeName(pair.counterpartSpecies))} · hit ${pair.huntHits}/${pair.huntAttempts} (${percent(pair.huntHitRate)}) · kill ${pair.kills}/${pair.huntAttempts} (${percent(pair.huntKillRate)})<br>${i18n.t('evolution.traitMatch')} n=${pair.traitMatchAttempts} · attempt Δ speed ${trait(pair.attemptTraitAdvantageMean.speed)} / size ${trait(pair.attemptTraitAdvantageMean.size)} · hit Δ speed ${trait(pair.successTraitAdvantageMean.speed)} / size ${trait(pair.successTraitAdvantageMean.size)} · kill Δ speed ${trait(pair.terminalTraitAdvantageMean.speed)} / size ${trait(pair.terminalTraitAdvantageMean.size)}${generationText}</div>`;
    }
    return `<div class="evo-traits">${i18n.t('evolution.asPrey')} ← ${this.escape(this.wildlifeName(pair.counterpartSpecies))} · escape ${pair.successfulEscapes}/${pair.fleeAttempts} (${percent(pair.escapeRate)}) · survive ${pair.survivedAttacks}/${pair.attacksReceived} (${percent(pair.attackSurvivalRate)})<br>${i18n.t('evolution.traitMatch')} n=${pair.traitMatchAttempts} · flee Δ speed ${trait(pair.attemptTraitAdvantageMean.speed)} / wariness ${trait(pair.attemptTraitAdvantageMean.wariness)} · escape Δ speed ${trait(pair.successTraitAdvantageMean.speed)} / wariness ${trait(pair.successTraitAdvantageMean.wariness)} · survive Δ speed ${trait(pair.terminalTraitAdvantageMean.speed)} / wariness ${trait(pair.terminalTraitAdvantageMean.wariness)}${generationText}</div>`;
  }

  updateNpcs(dt:number) {
    for(const agent of this.npcs.values()) {
      const n=agent.state;
      n.hunger=clamp(n.hunger+dt*.20,0,100); n.energy=clamp(n.energy-dt*.075,0,100); n.social=clamp(n.social-dt*.04,0,100);
      const wasMoving=agent.pathIndex<agent.path.length;
      this.moveNpc(agent,dt);
      agent.mesh.position.y=this.groundHeightAt(agent.mesh.position.x,agent.mesh.position.z);
      const isMoving=agent.pathIndex<agent.path.length || wasMoving;
      const activityActive=Boolean(agent.activityAnimationUntil&&now()<agent.activityAnimationUntil);
      if(agent.activityAnimationUntil&&now()>=agent.activityAnimationUntil){agent.activityAnimationUntil=undefined;agent.activityAnimation=undefined;}
      const locomotion=(agent.state.currentAction==='patrol'||agent.state.currentAction==='explore')?'Run':'Walk';
      this.setNpcAnimation(agent,activityActive?(agent.activityAnimation||'Idle'):(isMoving?locomotion:'Idle'));
      agent.mixer?.update(dt);
      if(agent.mixer)this.alignNpcVisualToGround(agent);
      if(agent.task && agent.path.length===0) this.completeTask(agent);
      n.position.x=agent.mesh.position.x;n.position.z=agent.mesh.position.z;n.heading=agent.mesh.rotation.y;
    }
    if(!this.aiPaused){
      for(const agent of dueNpcDecisions(this.npcs.values(),now(),this.maxInFlight-this.inFlight)){
        void this.requestDecision(agent);
      }
    }
  }

  moveNpc(agent:NpcRuntime,dt:number) {
    // A player conversation reaches its legal range before source head clearance.
    // Do not wait for the old generic final-waypoint 1.55 m collision threshold.
    if(reachedPlayerConversation(this.cameraMode==='firstPerson',agent.task?.action,agent.task?.targetNpcId,
      Math.hypot(agent.mesh.position.x-this.playerPosition.x,agent.mesh.position.z-this.playerPosition.z))){
      agent.path=[];agent.pathIndex=0;agent.yieldPlan=undefined;return;
    }
    if(agent.pathIndex>=agent.path.length){agent.path=[];agent.pathIndex=0;agent.yieldPlan=undefined;return;}
    const yielded=stepNpcYield(this.physics,{
      id:`npc:${agent.state.id}`,asset:agent.characterAsset,position:agent.mesh.position,yaw:agent.mesh.rotation.y,
      player:this.cameraMode==='firstPerson'?this.playerPosition:undefined,travel:this.playerTravel,
      activePath:true,blockedPlayer:this.playerBlockedNpcs.has(`npc:${agent.state.id}`),plan:agent.yieldPlan,
      dt,dynamic:this.physicsDynamicColliders(`npc:${agent.state.id}`)
    });
    agent.yieldPlan=yielded?.plan;
    if(yielded){agent.mesh.position.x=yielded.position.x;agent.mesh.position.z=yielded.position.z;return;}
    const p=agent.path[agent.pathIndex]; const pos=agent.mesh.position; const dx=p.x-pos.x,dz=p.z-pos.z,d=Math.hypot(dx,dz);
    if(d<.12){agent.pathIndex++;if(agent.pathIndex>=agent.path.length){agent.path=[];agent.pathIndex=0;}return;}
    const speed=1.65;
    const step=Math.min(d,speed*dt);
    const desiredHeading=Math.atan2(dx,dz);
    const heading=this.cameraMode==='firstPerson'
      ?safeNpcHeading(agent.characterAsset,pos,agent.mesh.rotation.y,desiredHeading,this.playerPosition):desiredHeading;
    const resolved=this.physics.moveKinematic({
      id:`npc:${agent.state.id}`,
      position:{x:pos.x,z:pos.z},
      displacement:{x:dx/d*step,z:dz/d*step},
      radius:.32,
      dynamic:this.physicsDynamicColliders(`npc:${agent.state.id}`),
      constraints:this.cameraMode==='firstPerson'?[npcHeadConstraint(agent.characterAsset,this.playerPosition,heading)]:[]
    });
    pos.x=resolved.position.x;pos.z=resolved.position.z;
    if(!agent.task?.approach&&resolved.collided&&agent.pathIndex===agent.path.length-1&&d<=1.55){
      agent.path=[];agent.pathIndex=0;
    }
    agent.mesh.rotation.y=heading;
  }

  async requestDecision(agent:NpcRuntime) {
    agent.pendingDecision=true; this.inFlight++; agent.state.lastDecisionAt=Date.now();
    const decisionEpoch=this.perceptionEpoch;
    const world=this.snapshot(agent); const allowed=this.allowedActions(agent,world);
    const req:DecisionRequest={npc:agent.state,world,allowedActions:allowed};
    try{
      const r=await fetch('/api/decision',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(req)});
      const d=await r.json() as DecisionResponse; if(!r.ok) throw new Error('decision failed');
      // Camera-mode transitions change whether the player exists in the NPC world.
      // Never apply a result generated from an obsolete perception snapshot.
      if(agent.removed)return;
      if(decisionEpoch!==this.perceptionEpoch){agent.nextDecisionAt=now()+250+Math.random()*500;return;}
      this.applyDecision(agent,d);
      this.log(`${agent.state.name} → ${d.action}${d.socialIntent?` / ${d.socialIntent}`:''} [${d.source} ${(d.confidence*100).toFixed(0)}%]`);
    }catch{
      agent.nextDecisionAt=now()+4000;
    }finally{agent.pendingDecision=false;this.inFlight--;}
  }

  snapshot(agent:NpcRuntime):DecisionRequest['world'] {
    const nearNpcs: DecisionRequest['world']['nearbyNpcs']=[...this.npcs.values()].filter(x=>x!==agent).map(x=>({
      id:x.state.id,name:x.state.name,role:x.state.role,mood:x.state.mood,distance:dist(agent.state.position,x.state.position),
      relationship:agent.state.relationships[x.state.id]??{affinity:50,trust:50,familiarity:20},currentAction:x.state.currentAction
    })).filter(x=>x.distance<=12);
    // First-person mode materializes the player into the NPC world model. God mode does not.
    if(this.cameraMode==='firstPerson') {
      const playerPos=this.playerPosition; const playerDistance=dist(agent.state.position,playerPos);
      if(playerDistance<=12) nearNpcs.push({id:'player',name:'玩家',role:'player',mood:'neutral',isPlayer:true,distance:playerDistance,relationship:agent.state.relationships.player??{affinity:50,trust:50,familiarity:5},currentAction:'idle'});
    }
    nearNpcs.sort((a,b)=>a.distance-b.distance); nearNpcs.splice(8);
    const nearObjects=[...this.objects.values()].filter(x=>x.mesh.visible).map(x=>({
      id:x.state.id,kind:x.state.kind,name:x.state.name,tags:x.state.tags,distance:dist(agent.state.position,x.state.position),usable:x.state.usable,pickupable:x.state.pickupable,item:x.state.item,capabilities:x.state.capabilities
    })).filter(x=>x.distance<=14).sort((a,b)=>a.distance-b.distance).slice(0,18);
    return {gameTime:this.gameTimeText(),minuteOfDay:this.minuteOfDay,weather:this.weather,nearbyNpcs:nearNpcs,nearbyObjects:nearObjects,recentEvents:this.recentEvents.slice(-8)};
  }

  allowedActions(agent:NpcRuntime,world:DecisionRequest['world']):DecisionAction[] {
    const a:DecisionAction[]=['idle','wander','inspect','explore'];
    const hasInventory=agent.state.inventory.some(i=>i.count>0);
    const nearHas=(...caps:InteractionCapability[])=>world.nearbyObjects.some(o=>caps.some(cap=>o.capabilities?.includes(cap)));
    if(world.nearbyNpcs.length)a.push('talk','visit','trade');
    if(agent.state.workAt||nearHas('work'))a.push('work');
    if(nearHas('rest','sit'))a.push('rest');
    if(nearHas('sleep'))a.push('sleep');
    if(agent.state.inventory.some(i=>['apple','bread'].includes(i.kind)&&i.count>0)||nearHas('buy'))a.push('eat');
    if(world.nearbyObjects.some(o=>o.pickupable||o.capabilities?.includes('pickup')))a.push('pickup');
    if(world.nearbyObjects.some(o=>o.usable))a.push('use_object');
    if(nearHas('harvest','forage','chop','mine'))a.push('harvest');
    if(nearHas('craft'))a.push('craft');
    if(nearHas('draw_water'))a.push('fetch_water');
    if(nearHas('buy','sell','trade'))a.push('trade');
    if(agent.state.role==='guard')a.push('patrol');
    if(hasInventory){
      a.push('drop_item');
      if(world.nearbyNpcs.length)a.push('gift','deliver');
    }
    return [...new Set(a)];
  }

  applyDecision(agent:NpcRuntime,d:DecisionResponse) {
    agent.lastDecision=d;
    this.applyStateShift(agent,d.stateShift);
    agent.state.currentAction=d.action;
    const task:ActionTask={action:d.action,targetNpcId:d.targetNpcId,targetObjectId:d.targetObjectId,intent:d.socialIntent||'smalltalk',startedAt:now()};
    agent.task=task;
    const commitmentMs=7000+d.commitment*2500; agent.nextDecisionAt=now()+commitmentMs+Math.random()*3500;
    if(d.action==='idle'){agent.task=undefined;agent.nextDecisionAt=now()+2500+Math.random()*2500;return;}
    if(d.action==='wander'){const target=this.randomPassableNear(agent.state.position,8,agent.state.chunkId);agent.path=this.findPath(agent.state.position,target);agent.task=undefined;return;}
    if(d.action==='explore'){const target=this.randomPassableNear(agent.state.position,20,agent.state.chunkId);agent.path=this.findPath(agent.state.position,target);return;}
    if(d.action==='patrol'){const localGuard=agent.state.chunkId?this.objects.get(`${agent.state.chunkId}_guard`):this.objects.get('guard_post');const origin=localGuard?.state.position||agent.state.position;const target=this.randomPassableNear(origin,13,agent.state.chunkId);agent.path=this.findPath(agent.state.position,target);return;}
    if(['talk','visit','trade','gift','deliver'].includes(d.action)&&d.targetNpcId){
      if(d.targetNpcId==='player'){
        // Only conversational actions may intentionally target the player. Economic/item actions stay NPC-to-NPC for now.
        if(!['talk','visit'].includes(d.action)||this.cameraMode!=='firstPerson'){
          const target=this.closestNpc(agent);
          if(!target){agent.task=undefined;agent.state.currentAction='idle';agent.nextDecisionAt=now()+1200;return;}
          task.targetNpcId=target.state.id;agent.path=this.findPath(agent.state.position,target.state.position);return;
        }
        task.targetNpcId='player';agent.path=this.findPath(agent.state.position,this.playerPosition);return;
      }
      const target=this.npcs.get(d.targetNpcId||'')||this.closestNpc(agent); if(!target){agent.task=undefined;return;} task.targetNpcId=target.state.id;agent.path=this.findPath(agent.state.position,target.state.position);return;
    }
    if(['talk','visit','gift','deliver'].includes(d.action)){
      const target=this.closestNpc(agent);if(!target){agent.task=undefined;return;}task.targetNpcId=target.state.id;agent.path=this.findPath(agent.state.position,target.state.position);return;
    }
    if(d.action==='trade'&&!d.targetObjectId&&this.closestNpc(agent)){const target=this.closestNpc(agent);if(target){task.targetNpcId=target.state.id;agent.path=this.findPath(agent.state.position,target.state.position);return;}}
    if(d.action==='drop_item'){this.dropNpcItem(agent);agent.task=undefined;return;}
    if(d.action==='eat' && agent.state.inventory.some(i=>['apple','bread'].includes(i.kind)&&i.count>0)){this.npcEat(agent);agent.task=undefined;return;}
    const obj=this.objectForAction(agent,d.action,d.targetObjectId); if(!obj){agent.task=undefined;agent.nextDecisionAt=now()+2500;return;} task.targetObjectId=obj.state.id;this.planNpcObjectPath(agent,task,obj);
  }

  planNpcObjectPath(agent:NpcRuntime,task:ActionTask,obj:RuntimeObject) {
    const current={x:agent.mesh.position.x,z:agent.mesh.position.z};
    const isOvenWork=isBakingOven(obj.state)&&(task.action==='work'||task.action==='craft');
    if(isOvenWork){
      task.approach=bakingWorkApproach(agent.characterAsset,obj.state.position,obj.mesh.userData.ovenPhysics?.collider,
        (point,radius)=>this.physics.isBlocked(point.x,point.z,radius));
      // No loaded/reachable facility stance means no work outcome, not crafting at
      // an arbitrary nearby point merely because pathfinding returned an empty path.
      if(!task.approach){agent.task=undefined;agent.path=[];agent.pathIndex=0;return;}
    }
    const destination=task.approach??obj.state.position;
    const path=this.findPath(current,destination);
    if(task.approach){
      const sameCell=Math.round(current.x)===Math.round(destination.x)&&Math.round(current.z)===Math.round(destination.z);
      if(!path.length&&!sameCell){agent.task=undefined;agent.path=[];agent.pathIndex=0;return;}
      // Retain the original grid planner, then approach the precise resolved stance.
      // Do not teleport the actor or stop at the old 1.55 m generic collision threshold.
      if(dist(current,destination)>.12)path.push({x:destination.x,z:destination.z});
    }
    agent.path=path;agent.pathIndex=0;
  }

  applyStateShift(agent:NpcRuntime,shift:DecisionResponse['stateShift']) {
    const n=agent.state;
    const moodUp:Record<Mood,Mood>={happy:'happy',calm:'happy',neutral:'calm',sad:'neutral',annoyed:'neutral',curious:'happy',tired:'calm'};
    const moodDown:Record<Mood,Mood>={happy:'calm',calm:'neutral',neutral:'annoyed',sad:'sad',annoyed:'annoyed',curious:'neutral',tired:'sad'};
    if(shift==='mood_up')n.mood=moodUp[n.mood];
    if(shift==='mood_down')n.mood=moodDown[n.mood];
    if(shift==='social_seek'){n.social=clamp(n.social-4,0,100);n.goal='找人交流，缓解社交需求';}
    if(shift==='social_withdraw'){n.social=clamp(n.social+2,0,100);n.goal='暂时独处，减少社交活动';}
    if(shift==='energy_conserve')n.goal='保存体力，优先休息';
    if(shift==='goal_intensify')n.goal=`专注于当前目标：${n.goal}`;
  }

  objectForAction(agent:NpcRuntime,action:DecisionAction,id?:string) {
    const chosen=id?this.objects.get(id):undefined;
    const has=(o:RuntimeObject,...caps:InteractionCapability[])=>caps.some(cap=>o.state.capabilities?.includes(cap));
    const valid=(o:RuntimeObject)=>o.mesh.visible&&(
      action==='work'? (o.state.id===agent.state.workAt||has(o,'work')):
      action==='rest'? has(o,'rest','sit'):
      action==='sleep'? has(o,'sleep'):
      action==='eat'? has(o,'buy'):
      action==='pickup'? (o.state.pickupable||has(o,'pickup')):
      action==='harvest'? has(o,'harvest','forage','chop','mine'):
      action==='craft'? has(o,'craft'):
      action==='fetch_water'? has(o,'draw_water'):
      action==='trade'? has(o,'buy','sell','trade'):
      action==='use_object'? o.state.usable:
      action==='inspect'? has(o,'inspect'):false);
    if(chosen&&valid(chosen))return chosen;
    return [...this.objects.values()].filter(o=>valid(o)&&dist(agent.state.position,o.state.position)<=18).sort((a,b)=>dist(agent.state.position,a.state.position)-dist(agent.state.position,b.state.position))[0];
  }

  completeTask(agent:NpcRuntime) {
    const task=agent.task;if(!task)return;
    if(['talk','visit','trade','gift','deliver'].includes(task.action)&&task.targetNpcId){
      if(task.targetNpcId==='player'){
        if(this.cameraMode!=='firstPerson'){
          agent.task=undefined;agent.path=[];agent.pathIndex=0;agent.state.currentAction='idle';agent.nextDecisionAt=now()+900+Math.random()*900;return;
        }
        const pp=this.playerPosition; if(dist(agent.state.position,pp)>PLAYER_CONVERSATION_REACH){agent.path=this.findPath(agent.state.position,pp);return;}
        this.npcTalkPlayerAuto(agent,task.intent||'smalltalk'); this.playActivity(agent,'Wave',1400);agent.task=undefined; return;
      }
      const other=this.npcs.get(task.targetNpcId||''); if(other&&dist(agent.state.position,other.state.position)>2.2){agent.path=this.findPath(agent.state.position,other.state.position);return;}
      if(other){
        if(task.action==='trade')this.npcTrade(agent,other);
        else if(task.action==='gift')this.npcGift(agent,other);
        else if(task.action==='deliver')this.npcDeliver(agent,other);
        else this.npcConversation(agent,other,task.action==='visit'?'greet':task.intent||'smalltalk');
        this.playActivity(agent,task.action==='trade'?'Yes':'Wave',1500);
      }
      agent.task=undefined;return;
    }
    if(task.action==='patrol'){agent.state.energy=clamp(agent.state.energy-2,0,100);agent.state.money+=1;this.remember(agent,'完成了一段巡逻路线。',1);this.playActivity(agent,'Yes',900);agent.task=undefined;return;}
    if(task.action==='explore'){this.remember(agent,`探索到了 ${agent.state.position.x.toFixed(0)},${agent.state.position.z.toFixed(0)} 一带。`,1);agent.state.mood=agent.state.mood==='neutral'?'curious':agent.state.mood;this.playActivity(agent,'Yes',900);agent.task=undefined;return;}
    const obj=task.targetObjectId?this.objects.get(task.targetObjectId):undefined;
    if(obj&&isBakingOven(obj.state)&&(task.action==='work'||task.action==='craft')){
      if(!task.approach||dist(agent.mesh.position,task.approach)>.14){this.planNpcObjectPath(agent,task,obj);return;}
      agent.mesh.rotation.y=this.cameraMode==='firstPerson'
        ?safeNpcHeading(agent.characterAsset,agent.mesh.position,agent.mesh.rotation.y,task.approach.yaw,this.playerPosition)
        :task.approach.yaw;
    }
    if(obj&&dist(agent.state.position,obj.state.position)>2.3){agent.path=this.findPath(agent.state.position,obj.state.position);return;}
    switch(task.action){
      case 'work': this.npcWork(agent,obj);this.playActivity(agent,'Punch',1500);break;
      case 'rest': agent.state.energy=clamp(agent.state.energy+24,0,100);agent.state.mood=agent.state.mood==='tired'?'calm':agent.state.mood;this.say(agent,'休息一下，感觉好多了。');break;
      case 'sleep': agent.state.energy=clamp(agent.state.energy+45,0,100);agent.state.hunger=clamp(agent.state.hunger+5,0,100);agent.state.mood='calm';this.say(agent,'睡一会儿，精神恢复了。');break;
      case 'eat': this.npcEat(agent);this.playActivity(agent,'Yes',900);break;
      case 'pickup': if(obj)this.pickupForNpc(agent,obj);break;
      case 'harvest': if(obj)this.npcHarvest(agent,obj);this.playActivity(agent,'Punch',1600);break;
      case 'craft': if(obj)this.npcCraft(agent,obj);this.playActivity(agent,'Punch',1900);break;
      case 'fetch_water': if(obj)this.npcFetchWater(agent,obj);this.playActivity(agent,'Punch',1000);break;
      case 'trade': if(obj)this.npcTradeAtMarket(agent,obj);this.playActivity(agent,'Yes',1200);break;
      case 'use_object': if(obj)this.useObjectNpc(agent,obj);break;
      case 'inspect': if(obj){this.say(agent,`仔细看看，${obj.state.name}似乎值得留意。`);this.playActivity(agent,'Yes',900);}break;
    }
    agent.task=undefined;
  }

  playActivity(agent:NpcRuntime,animation:string,duration:number) {
    agent.activityAnimation=animation;
    agent.activityAnimationUntil=now()+duration;
  }

  npcWork(agent:NpcRuntime,obj?:RuntimeObject) {
    const n=agent.state;
    n.energy=clamp(n.energy-5,0,100);n.hunger=clamp(n.hunger+4,0,100);
    if(n.role==='farmer'&&obj?.state.kind==='farm_plot'){this.addInventory(n.inventory,'grain',1);n.money+=1;}
    else if(n.role==='baker'&&obj?.state.tags.includes('baker')){this.npcCraft(agent,obj);n.money+=1;}
    else if(n.role==='shopkeeper'){n.money+=3;n.social=clamp(n.social+2,0,100);}
    else if(n.role==='guard'){n.money+=2;this.remember(agent,'值守了一段时间。',1);}
    else if(n.role==='maker'){n.money+=2;if(Math.random()<.35)this.addInventory(n.inventory,'wood',1);}
    else n.money+=2;
    this.event(`${n.name} 完成了一轮 ${n.role} 工作。`);
  }

  npcHarvest(agent:NpcRuntime,obj:RuntimeObject) {
    const n=agent.state;
    if(typeof obj.state.resourceAmount==='number'){
      if(obj.state.resourceAmount<=0){this.say(agent,'这里暂时没有可采集的资源了。');return;}
      obj.state.resourceAmount=Math.max(0,obj.state.resourceAmount-1);
    }
    n.energy=clamp(n.energy-6,0,100);n.hunger=clamp(n.hunger+3,0,100);
    if(obj.state.tags.includes('mine')||obj.state.tags.includes('resource')){this.addInventory(n.inventory,'stone',2);this.event(`${n.name} 在${obj.state.name}采集了石料。`);}
    else if(obj.state.kind==='farm_plot'){this.addInventory(n.inventory,'grain',2);if(Math.random()<.35)this.addInventory(n.inventory,'flower',1);this.event(`${n.name} 收获了农作物。`);}
    else if(obj.state.kind==='tree'){const kind:ItemKind=obj.state.tags.includes('apple')?'apple':'wood';this.addInventory(n.inventory,kind,1);this.event(`${n.name} 从${obj.state.name}采集了${this.itemName(kind)}。`);}
  }

  npcCraft(agent:NpcRuntime,obj:RuntimeObject) {
    const result=craftAtWorkstation(obj.state.tags,agent.state.inventory,agent.state.role);
    if(result.ok&&result.recipe){
      agent.state.energy=clamp(agent.state.energy-5,0,100);
      this.say(agent,`${result.recipe.name}完成了。`);
      this.event(`${agent.state.name} 在${obj.state.name}${result.recipe.name}。`);
      return;
    }
    const missing=(result.missing||[]).map(kind=>this.itemName(kind)).join('、');
    this.say(agent,result.recipe?`${result.recipe.name}还缺：${missing||'材料'}。`:`这里暂时没有适合的制作配方。`);
  }

  npcFetchWater(agent:NpcRuntime,obj:RuntimeObject) {
    if(obj.state.kind!=='well')return;
    this.addInventory(agent.state.inventory,'water',1);
    agent.state.energy=clamp(agent.state.energy-1,0,100);
    this.say(agent,'带些水回去。');
    this.event(`${agent.state.name} 从水井取了水。`);
  }

  npcTradeAtMarket(agent:NpcRuntime,_obj:RuntimeObject) {
    const sell=agent.state.inventory.find(i=>['grain','flour','wood','plank','stone','flower','tool'].includes(i.kind)&&i.count>0);
    if(sell){sell.count--;agent.state.money+=sell.kind==='tool'?4:2;this.say(agent,`卖掉了一份${this.itemName(sell.kind)}。`);return;}
    if(agent.state.money>=2){agent.state.money-=2;this.addInventory(agent.state.inventory,'bread',1);this.say(agent,'买了一份面包。');}
  }

  npcTrade(a:NpcRuntime,b:NpcRuntime) {
    const sell=a.state.inventory.find(i=>i.count>0&&i.kind!=='coin');
    const buy=b.state.inventory.find(i=>i.count>0&&i.kind!=='coin');
    if(sell&&b.state.money>=2){sell.count--;this.addInventory(b.state.inventory,sell.kind,1);b.state.money-=2;a.state.money+=2;this.say(a,`和${b.state.name}交易了${this.itemName(sell.kind)}。`);}
    else if(buy&&a.state.money>=2){buy.count--;this.addInventory(a.state.inventory,buy.kind,1);a.state.money-=2;b.state.money+=2;this.say(a,`从${b.state.name}那里买到了${this.itemName(buy.kind)}。`);}
    else this.say(a,'这次没谈成交易。');
    const rel=a.state.relationships[b.state.id]??{affinity:50,trust:50,familiarity:20};rel.familiarity=clamp(rel.familiarity+3,0,100);a.state.relationships[b.state.id]=rel;
  }

  npcGift(a:NpcRuntime,b:NpcRuntime) {
    const item=a.state.inventory.find(i=>i.count>0&&i.kind!=='coin');if(!item){this.say(a,'我现在没什么能送的。');return;}
    item.count--;this.addInventory(b.state.inventory,item.kind,1);
    const rel=a.state.relationships[b.state.id]??{affinity:50,trust:50,familiarity:20};
    rel.affinity=clamp(rel.affinity+5,0,100);rel.trust=clamp(rel.trust+2,0,100);rel.familiarity=clamp(rel.familiarity+2,0,100);a.state.relationships[b.state.id]=rel;
    this.say(a,`这个${this.itemName(item.kind)}送给你。`);this.remember(a,`送给${b.state.name}一份${this.itemName(item.kind)}。`,2);
  }

  npcDeliver(a:NpcRuntime,b:NpcRuntime) {
    const priorities:Record<NpcRole,ItemKind[]>={farmer:['tool','water','bread'],baker:['flour','grain','water','wood'],shopkeeper:['bread','apple','tool','plank'],guard:['bread','water','tool'],maker:['wood','plank','stone','water'],resident:['bread','apple','water']};
    const wanted=priorities[b.state.role];
    const slot=wanted.map(k=>a.state.inventory.find(i=>i.kind===k&&i.count>0)).find(Boolean);
    if(!slot){this.say(a,`手头没有${b.state.name}正需要的东西。`);return;}
    slot!.count--;this.addInventory(b.state.inventory,slot!.kind,1);a.state.money+=1;
    this.say(a,`给${b.state.name}送到了${this.itemName(slot!.kind)}。`);this.remember(a,`完成了给${b.state.name}的送货。`,2);
  }

  npcEat(agent:NpcRuntime) {
    const food=agent.state.inventory.find(i=>['apple','bread'].includes(i.kind)&&i.count>0);
    if(food){food.count--;agent.state.hunger=clamp(agent.state.hunger-(food.kind==='bread'?38:25),0,100);this.say(agent,food.kind==='bread'?'面包还不错。':'这个苹果挺甜。');return;}
    if(agent.state.money>=2){agent.state.money-=2;agent.state.hunger=clamp(agent.state.hunger-35,0,100);this.say(agent,'总算吃上东西了。');}
  }

  pickupForNpc(agent:NpcRuntime,obj:RuntimeObject) {
    this.portables.pickupForNpc(agent,obj);
  }

  useObjectNpc(agent:NpcRuntime,obj:RuntimeObject) {
    if(obj.state.kind==='well'){agent.state.mood=agent.state.mood==='annoyed'?'neutral':agent.state.mood;this.say(agent,'井水很凉。');}
    else if(obj.state.kind==='bench'||obj.state.kind==='bed'){agent.state.energy=clamp(agent.state.energy+12,0,100);}
    else if(obj.state.kind==='food_stall')this.npcEat(agent);
    else if(obj.state.kind==='tree'&&obj.state.item)this.pickupForNpc(agent,obj);
    else this.say(agent,`我用了${obj.state.name}。`);
  }

  dropNpcItem(agent:NpcRuntime) {
    this.portables.drop(agent);
  }

  async npcConversation(a:NpcRuntime,b:NpcRuntime,intent:SocialIntent) {
    a.state.social=clamp(a.state.social+15,0,100);b.state.social=clamp(b.state.social+9,0,100);
    const req:DialogueRequest={locale:this.locale,speaker:this.actor(a,b),listener:this.actor(b,a),situation:`${a.state.name} 主动与 ${b.state.name} 在小镇中交谈。`,intent,world:{gameTime:this.gameTimeText(),weather:this.weather,nearbyTags:this.nearbyTags(a.state.position)},recentLines:[a.state.lastDialogue,b.state.lastDialogue].filter(Boolean) as string[]};
    try{const r=await fetch('/api/dialogue',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(req)});const d=await r.json() as DialogueResponse;this.say(a,d.text);a.state.lastDialogue=d.text;this.applyRelation(a,b,d.relationEffect);this.remember(a,`与${b.state.name}交谈：${d.text}`,2);this.log(`${a.state.name} 对 ${b.state.name}：${d.text} [${d.source}]`);}catch{this.say(a,'嗨。');}
  }

  actor(a:NpcRuntime,b?:NpcRuntime) {return {id:a.state.id,name:a.state.name,role:a.state.role,mood:a.state.mood,relationship:b?a.state.relationships[b.state.id]:undefined};}
  applyRelation(a:NpcRuntime,b:NpcRuntime,effect:DialogueResponse['relationEffect']){const r=a.state.relationships[b.state.id]??{affinity:50,trust:50,familiarity:20};const d=effect==='positive'?3:effect==='negative'?-3:0;r.affinity=clamp(r.affinity+d,0,100);r.trust=clamp(r.trust+(effect==='positive'?1:effect==='negative'?-1:0),0,100);r.familiarity=clamp(r.familiarity+2,0,100);a.state.relationships[b.state.id]=r;}
  remember(a:NpcRuntime,summary:string,importance:number){a.state.memories.push({id:crypto.randomUUID(),at:Date.now(),summary,importance});if(a.state.memories.length>24)a.state.memories.splice(0,a.state.memories.length-24);}

  closestNpc(agent:NpcRuntime){return [...this.npcs.values()].filter(x=>x!==agent).sort((a,b)=>dist(agent.state.position,a.state.position)-dist(agent.state.position,b.state.position))[0];}
  nearbyTags(p:Vec2){return [...this.objects.values()].filter(o=>o.mesh.visible&&dist(p,o.state.position)<6).flatMap(o=>o.state.tags).slice(0,12);}

  interact() {
    if(!this.hoverEntity)return;
    if(this.hoverEntity.type==='npc'){const n=this.npcs.get(this.hoverEntity.id);if(n)this.playerTalk(n);}
    else if(this.hoverEntity.type==='wildlife'){
      const animal=this.wildlife.get(this.hoverEntity.id);
      if(animal)this.playerUseWildlife(animal);
    }else {
      const o=this.objects.get(this.hoverEntity.id);
      if(o&&this.playerOverlapsObjectTrigger(o.state.id))this.playerUse(o);
    }
  }

  playerUseWildlife(animal:WildlifeRuntime) {
    if(this.cameraMode!=='firstPerson')return;
    const state=animal.state;
    if(!isWildlifeDomesticationEligible(state.species)){
      this.toast(`${this.wildlifeName(state.species)} · ${i18n.t('wildlife.health')} ${state.health.toFixed(0)} · ${i18n.t('wildlife.action')} ${state.currentAction}`);
      return;
    }
    this.openWildlifeInteractionMenu(animal);
  }

  openWildlifeInteractionMenu(animal:WildlifeRuntime) {
    const state=animal.state;
    state.domestication=normalizeWildlifeDomestication(state.species,state.domestication);
    const domestication=state.domestication!;
    this.interactionOpen=true;
    this.interactionObjectId=undefined;
    this.interactionWildlifeId=state.id;
    ui.overlay.classList.add('hidden');
    if(this.controls.isLocked)this.controls.unlock();
    ui.interactionTitle.textContent=`${i18n.t('domestication.title')} · ${this.wildlifeName(state.species)}`;
    ui.interactionMeta.textContent=`${i18n.t('domestication.progress')} ${domestication.tameProgress.toFixed(0)}/100 · ${i18n.t('domestication.owner')} ${domestication.ownerId||i18n.t('domestication.unowned')} · ${i18n.t('domestication.command')} ${i18n.t(`domestication.command.${domestication.command}`)} · ${i18n.t('domestication.breeding')} ${i18n.t(domestication.breedingAllowed?'domestication.breeding.on':'domestication.breeding.off')}`;
    ui.interactionActions.innerHTML='';

    const add=(label:string,run:()=>void)=>{
      const button=document.createElement('button');
      button.textContent=label;
      button.addEventListener('click',()=>{run();this.closeInteractionMenu(true);});
      ui.interactionActions.appendChild(button);
    };

    if(!domestication.ownerId){
      add(i18n.t('domestication.feed'),()=>this.feedWildlifeForTaming(animal));
    }else if(domestication.ownerId==='player'){
      for(const command of ['follow','stay','graze','none'] as WildlifeDomesticationCommand[]){
        add(i18n.t(`domestication.command.${command}`),()=>this.commandOwnedWildlife(animal,command));
      }
      add(i18n.t(domestication.breedingAllowed?'domestication.disableBreeding':'domestication.enableBreeding'),()=>this.toggleOwnedWildlifeBreeding(animal));
    }
    ui.interaction.classList.remove('hidden');
  }

  feedWildlifeForTaming(animal:WildlifeRuntime) {
    if(this.cameraMode!=='firstPerson'||this.playerInventory.grain<=0){
      this.toast(i18n.t('domestication.needGrain'));return;
    }
    const currentDay=this.day+this.minuteOfDay/1440;
    const result=feedWildlifeForTaming(animal.state.species,animal.state.domestication,'player',currentDay);
    if(!result.applied||!result.state){
      this.toast(result.reason==='ineligible'?i18n.t('domestication.ineligible'):i18n.t('domestication.owner'));return;
    }
    this.playerInventory.grain--;
    animal.state.domestication=result.state;
    animal.state.hunger=clamp(animal.state.hunger-18,0,100);
    this.event(`${this.wildlifeName(animal.state.species)} ${i18n.t('domestication.progress')} → ${result.state.tameProgress.toFixed(0)}/100`);
    if(result.claimed)this.toast(i18n.t('domestication.claimed'));
    else this.toast(`${i18n.t('domestication.progress')} ${result.state.tameProgress.toFixed(0)}/100`);
    void this.saveWorldState();
  }

  commandOwnedWildlife(animal:WildlifeRuntime,command:WildlifeDomesticationCommand) {
    if(this.cameraMode!=='firstPerson')return;
    const currentDay=this.day+this.minuteOfDay/1440;
    const next=setWildlifeDomesticationCommand(animal.state.species,animal.state.domestication,'player',command,currentDay);
    if(!next)return;
    animal.state.domestication=next;
    animal.path=[];animal.pathIndex=0;animal.controllerSpeed=0;animal.actionResolved=true;animal.nextDecisionAt=now();
    animal.state.targetObjectId=undefined;animal.state.targetWildlifeId=undefined;animal.state.targetChunkId=undefined;
    this.event(`${this.wildlifeName(animal.state.species)} ${i18n.t('domestication.command')} → ${i18n.t(`domestication.command.${command}`)}`);
    void this.saveWorldState();
  }

  toggleOwnedWildlifeBreeding(animal:WildlifeRuntime) {
    if(this.cameraMode!=='firstPerson')return;
    const currentDay=this.day+this.minuteOfDay/1440;
    const current=normalizeWildlifeDomestication(animal.state.species,animal.state.domestication);
    if(!current)return;
    const next=setWildlifeBreedingPermission(animal.state.species,current,'player',!current.breedingAllowed,currentDay);
    if(!next)return;
    animal.state.domestication=next;
    this.event(`${this.wildlifeName(animal.state.species)} ${i18n.t('domestication.breeding')} → ${i18n.t(next.breedingAllowed?'domestication.breeding.on':'domestication.breeding.off')}`);
    void this.saveWorldState();
  }

  async npcTalkPlayerAuto(n:NpcRuntime,intent:SocialIntent) {
    if(this.cameraMode!=='firstPerson')return;
    const dialogueEpoch=this.perceptionEpoch;
    const req:DialogueRequest={locale:this.locale,speaker:{id:n.state.id,name:n.state.name,role:n.state.role,mood:n.state.mood,relationship:n.state.relationships.player},listener:{id:'player',name:'玩家',role:'visitor',mood:'neutral'},situation:`${n.state.name} 主动走到玩家附近并开始交谈。`,intent,world:{gameTime:this.gameTimeText(),weather:this.weather,nearbyTags:this.nearbyTags(n.state.position)},recentLines:[n.state.lastDialogue].filter(Boolean) as string[]};
    try{const r=await fetch('/api/dialogue',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(req)});const d=await r.json() as DialogueResponse;if(dialogueEpoch!==this.perceptionEpoch||this.cameraMode!=='firstPerson')return;this.say(n,d.text);n.state.lastDialogue=d.text;n.state.social=clamp(n.state.social+12,0,100);const rel=n.state.relationships.player??{affinity:50,trust:50,familiarity:5};const delta=d.relationEffect==='positive'?3:d.relationEffect==='negative'?-3:0;rel.affinity=clamp(rel.affinity+delta,0,100);rel.familiarity=clamp(rel.familiarity+2,0,100);n.state.relationships.player=rel;this.remember(n,`我主动和玩家交谈：${d.text}`,2);this.log(`${n.state.name} 主动对玩家：${d.text} [${d.source}]`);}catch{if(dialogueEpoch===this.perceptionEpoch&&this.cameraMode==='firstPerson')this.say(n,'嗨。');}
  }

  async playerTalk(n:NpcRuntime) {
    if(this.cameraMode!=='firstPerson')return;
    const dialogueEpoch=this.perceptionEpoch;
    const req:DialogueRequest={locale:this.locale,speaker:{id:n.state.id,name:n.state.name,role:n.state.role,mood:n.state.mood},listener:{id:'player',name:'玩家',role:'visitor',mood:'neutral'},situation:'玩家主动走近 NPC 并开始交谈。',intent:'greet',world:{gameTime:this.gameTimeText(),weather:this.weather,nearbyTags:this.nearbyTags(n.state.position)},recentLines:[n.state.lastDialogue].filter(Boolean) as string[]};
    try{const r=await fetch('/api/dialogue',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(req)});const d=await r.json() as DialogueResponse;if(dialogueEpoch!==this.perceptionEpoch||this.cameraMode!=='firstPerson')return;this.say(n,d.text);n.state.lastDialogue=d.text;n.state.social=clamp(n.state.social+8,0,100);this.remember(n,`玩家来和我说话：${d.text}`,2);this.log(`${n.state.name} 对玩家：${d.text} [${d.source}]`);}catch{if(dialogueEpoch===this.perceptionEpoch&&this.cameraMode==='firstPerson')this.say(n,'你好。');}
  }

  playerUse(o:RuntimeObject) {
    if(this.cameraMode!=='firstPerson')return;
    const actions=o.state.capabilities?.length?o.state.capabilities:this.defaultCapabilities(o.state);
    if(actions.length===1){this.executePlayerInteraction(o,actions[0]);return;}
    this.openInteractionMenu(o,actions);
  }

  openInteractionMenu(o:RuntimeObject,actions:InteractionCapability[]) {
    this.interactionOpen=true;
    this.interactionObjectId=o.state.id;
    ui.overlay.classList.add('hidden');
    if(this.controls.isLocked)this.controls.unlock();
    ui.interactionTitle.textContent=o.state.name;
    ui.interactionMeta.textContent=`${o.state.kind} · ${o.state.tags.join(' / ')}`;
    ui.interactionActions.innerHTML='';
    for(const action of actions){
      const button=document.createElement('button');
      button.textContent=this.interactionLabel(action);
      button.addEventListener('click',()=>{
        const current=this.objects.get(this.interactionObjectId||'');
        if(current)this.executePlayerInteraction(current,action);
        this.closeInteractionMenu(true);
      });
      ui.interactionActions.appendChild(button);
    }
    ui.interaction.classList.remove('hidden');
  }

  closeInteractionMenu(relock=false) {
    ui.interaction.classList.add('hidden');
    this.interactionOpen=false;
    this.interactionObjectId=undefined;
    this.interactionWildlifeId=undefined;
    if(relock&&this.cameraMode==='firstPerson')this.controls.lock();
  }

  interactionLabel(action:InteractionCapability) {
    return i18n.t(`interaction.${action}`);
  }

  playerPhysicalToolContact(o:RuntimeObject) {
    const result=resolveContactAction(this.physics,{
      actorId:'player',
      targetId:`object:${o.state.id}`,
      start:{...this.playerPosition},
      end:{...o.state.position},
      maxRange:3.2,
      sweepRadius:.06,
      dynamic:this.physicsDynamicColliders('player')
    });
    if(result.status==='hit')return true;
    this.toast(result.status==='blocked'?'工具动作被实体或障碍阻挡':'目标不在可触及范围');
    return false;
  }

  executePlayerInteraction(o:RuntimeObject,action:InteractionCapability) {
    const s=o.state;
    // A menu may outlive its target or a camera-mode change. Revalidate at execution.
    if(this.cameraMode!=='firstPerson'||this.objects.get(s.id)!==o||!o.mesh.visible||!this.playerOverlapsObjectTrigger(s.id))return;
    if(!(s.capabilities?.length?s.capabilities:this.defaultCapabilities(s)).includes(action))return;
    const takeFirst=()=>{
      const order:ItemKind[]=['flower','apple','grain','flour','wood','plank','stone','water','tool','bread'];
      return order.find(k=>this.playerInventory[k]>0);
    };
    switch(action){
      case 'inspect':
        this.toast(`${s.name} · ${s.tags.join(' / ')}`);break;
      case 'pickup': {
        const received=this.portables.pickupForPlayer(o);
        if(received){this.toast(`${this.itemName(received.kind)} ×${received.count}`);this.event(`玩家拾取了 ${s.name}。`);}
        break;
      }
      case 'draw_water':
        this.playerInventory.water++;this.toast('打了一份井水');this.event('玩家从水井取水。');break;
      case 'drink':
        this.toast('喝了些清凉的井水');this.event('玩家在水井边喝水。');break;
      case 'wash':
        this.toast('简单清洗了一下');this.event('玩家使用水井清洗。');break;
      case 'harvest':
      case 'forage': {
        const kind=s.item||(s.kind==='farm_plot'?'grain':'flower');
        if((s.resourceAmount??1)<=0){this.toast(`${s.name}暂时没有可采集资源`);break;}
        this.playerInventory[kind]++;s.resourceAmount=Math.max(0,(s.resourceAmount??3)-1);this.toast(`获得：${this.itemName(kind)}`);this.event(`玩家从${s.name}采集了资源。`);break;
      }
      case 'chop':
        if(!this.playerPhysicalToolContact(o))break;
        if((s.resourceAmount??3)<=0){this.toast('这棵树暂时没有可砍取的木料');break;}
        this.playerInventory.wood+=2;s.resourceAmount=Math.max(0,(s.resourceAmount??4)-1);this.toast('获得：木料 ×2');this.event(`玩家砍取了${s.name}的木料。`);break;
      case 'mine':
        if(!this.playerPhysicalToolContact(o))break;
        if((s.resourceAmount??4)<=0){this.toast('这里暂时没有可采的石料');break;}
        this.playerInventory.stone+=2;s.resourceAmount=Math.max(0,(s.resourceAmount??6)-1);this.toast('获得：石料 ×2');this.event(`玩家在${s.name}采矿。`);break;
      case 'craft': {
        const inv=(Object.entries(this.playerInventory) as Array<[ItemKind,number]>).map(([kind,count])=>({kind,count}));
        const result=craftAtWorkstation(s.tags,inv);
        if(result.ok&&result.recipe){
          for(const slot of inv)this.playerInventory[slot.kind]=slot.count;
          this.toast(`制作：${result.recipe.name}`);this.event(`玩家在${s.name}${result.recipe.name}。`);
        }else{
          const missing=(result.missing||[]).map(kind=>this.itemName(kind)).join('、');
          this.toast(result.recipe?`缺少：${missing||'材料'}`:'这里没有可用配方');
        }
        break;
      }
      case 'work':
        this.playerInventory.coin+=2;this.minuteOfDay+=12;this.toast('完成一轮工作：+2 硬币');this.event(`玩家在${s.name}工作。`);break;
      case 'buy':
        if(this.playerInventory.coin>=2){this.playerInventory.coin-=2;this.playerInventory.bread++;this.toast('购买：面包 -2 硬币');}
        else this.toast('硬币不足');
        break;
      case 'sell': {
        const kind=takeFirst();if(!kind){this.toast('没有可出售物品');break;}
        this.playerInventory[kind]--;this.playerInventory.coin+=kind==='tool'?4:2;this.toast(`出售：${this.itemName(kind)}`);break;
      }
      case 'trade':
        this.toast('这里支持买卖；可分别选择购买或出售');break;
      case 'store':
      case 'load': {
        const kind=takeFirst();if(!kind){this.toast('背包里没有可存入的物品');break;}
        this.playerInventory[kind]--;s.storage??=[];const slot=s.storage.find(i=>i.kind===kind);if(slot)slot.count++;else s.storage.push({kind,count:1});this.toast(`存入：${this.itemName(kind)}`);break;
      }
      case 'take':
      case 'unload': {
        const slot=s.storage?.find(i=>i.count>0);if(!slot){this.toast('里面是空的');break;}
        slot.count--;this.playerInventory[slot.kind]++;this.toast(`取出：${this.itemName(slot.kind)}`);break;
      }
      case 'sit':
      case 'rest':
        this.minuteOfDay+=15;this.toast('休息了一会儿');break;
      case 'sleep':
        this.minuteOfDay+=60;this.toast('睡了一小时');this.event(`玩家在${s.name}休息。`);break;
      case 'visit':
        this.toast(`拜访：${s.name}`);this.event(`玩家拜访了${s.name}。`);break;
    }
  }

  pickEntity(pointer:THREE.Vector2,maxDistance:number) {
    this.raycaster.setFromCamera(pointer,this.camera);
    const targets:THREE.Object3D[]=[...[...this.npcs.values()].map(n=>n.mesh), ...[...this.wildlife.values()].filter(x=>!x.removed).map(x=>x.mesh), ...[...this.objects.values()].filter(o=>o.mesh.visible).map(o=>o.mesh)];
    const hits=this.raycaster.intersectObjects(targets,true).filter(h=>h.distance<=maxDistance);
    for(const h of hits){let o:THREE.Object3D|null=h.object;while(o&&!o.userData.entityType)o=o.parent;if(o?.userData.entityType==='npc'||o?.userData.entityType==='object'||o?.userData.entityType==='wildlife')return {type:o.userData.entityType as 'npc'|'object'|'wildlife',id:String(o.userData.entityId)};}
    return undefined;
  }

  updateRaycast() {
    const pointer=this.cameraMode==='god'?this.godPointer:new THREE.Vector2(0,0);
    this.hoverEntity=this.pickEntity(pointer,this.cameraMode==='god'?Infinity:3.2);
    if(this.cameraMode==='firstPerson'&&this.hoverEntity?.type==='object'&&!this.playerOverlapsObjectTrigger(this.hoverEntity.id)){
      this.hoverEntity=undefined;
    }
    if(this.cameraMode==='god'){
      if(!this.hoverEntity){ui.prompt.textContent='';return;}
      const name=this.hoverEntity.type==='npc'?this.npcs.get(this.hoverEntity.id)?.state.name:this.hoverEntity.type==='wildlife'?this.wildlifeName(this.wildlife.get(this.hoverEntity.id)!.state.species):this.objects.get(this.hoverEntity.id)?.state.name;
      ui.prompt.textContent=i18n.t('prompt.god',{name:name||''});return;
    }
    if(!this.hoverEntity){ui.prompt.textContent='';return;}
    if(this.hoverEntity.type==='npc'){const n=this.npcs.get(this.hoverEntity.id)!;ui.prompt.textContent=i18n.t('prompt.talk',{name:n.state.name});}
    else if(this.hoverEntity.type==='wildlife'){const w=this.wildlife.get(this.hoverEntity.id)!;const key=isWildlifeDomesticationEligible(w.state.species)?'prompt.domesticated':'prompt.wildlife';ui.prompt.textContent=i18n.t(key,{name:this.wildlifeName(w.state.species)});}
    else {const o=this.objects.get(this.hoverEntity.id)!;const count=o.state.capabilities?.length||1;ui.prompt.textContent=i18n.t('prompt.object',{name:o.state.name,count});}
  }

  updateUi() {
    const world=this.coarseWorld.status();
    const physicsStats=this.physics.stats();
    const movableBodies=[...this.objects.values()].filter(object=>worldObjectRigidBody(object.state)&&object.mesh.visible);
    const activePhysicsBodies=this.npcs.size+this.wildlife.size+movableBodies.length+(this.cameraMode==='firstPerson'?1:0);
    const townCart=this.objects.get('cart_town');
    const playerGroundingError=this.cameraMode==='firstPerson'
      ?Math.abs(this.camera.position.y-(this.groundHeightAt(this.camera.position.x,this.camera.position.z)+1.7))
      :0;
    const npcGroundingMaxError=[...this.npcs.values()].reduce((max,agent)=>agent.removed?max:Math.max(max,Math.abs(agent.mesh.position.y-this.groundHeightAt(agent.mesh.position.x,agent.mesh.position.z))),0);
    const wildlifeGroundingMaxError=[...this.wildlife.values()].reduce((max,animal)=>animal.removed?max:Math.max(max,Math.abs(animal.mesh.position.y-this.groundHeightAt(animal.mesh.position.x,animal.mesh.position.z))),0);
    const buildingTargets=this.visualTargets.filter(target=>{
      const id=String(target.group.userData.entityId||'');
      return this.objects.get(id)?.state.kind==='building'
        &&target.fit==='exactBounds'&&target.resolvedSize&&target.targetWidth&&target.targetDepth;
    });
    const buildingMinHeight=buildingTargets.length?Math.min(...buildingTargets.map(target=>target.resolvedSize!.y)):0;
    const buildingMaxBoundsError=buildingTargets.reduce((max,target)=>Math.max(
      max,
      Math.abs(target.resolvedSize!.x-target.targetWidth!),
      Math.abs(target.resolvedSize!.y-target.height),
      Math.abs(target.resolvedSize!.z-target.targetDepth!)
    ),0);
    const wellTarget=this.visualTargets.find(target=>target.asset==='wellAsset'&&target.resolvedSize);
    const wellVisualSize=wellTarget?.resolvedSize;
    const semanticLicensedIds=['bench_w','bench_e','farm_plot','market','maker_table','guard_post','bed_n','mill'];
    const semanticLicensedObjects=semanticLicensedIds.map(id=>this.objects.get(id)).filter((object):object is RuntimeObject=>Boolean(object));
    const semanticLicensedResolved=semanticLicensedObjects.filter(object=>{
      let meshes=0;object.mesh.traverse(child=>{if((child as THREE.Mesh).isMesh)meshes++;});return meshes>0;
    }).length;
    const semanticPrimitiveMeshes=semanticLicensedObjects.reduce((count,object)=>{
      object.mesh.traverse(child=>{
        const mesh=child as THREE.Mesh;
        if(mesh.isMesh&&(mesh.geometry?.type==='BoxGeometry'||mesh.geometry?.type==='CylinderGeometry'||mesh.geometry?.type==='ConeGeometry'))count++;
      });
      return count;
    },0);
    // Read-only evidence, separate from the eight already accepted furniture targets.
    // Resolved bounds are diagnostics, not a substitute for first-person screenshot review.
    const ovens=[...this.objects.values()].filter(object=>isBakingOven(object.state)).map(object=>{
      const target=this.visualTargets.find(candidate=>candidate.group===object.mesh&&candidate.asset===BAKING_OVEN_ASSET);
      let meshes=0,primitives=0;
      object.mesh.traverse(child=>{
        const mesh=child as THREE.Mesh;
        if(mesh.isMesh){meshes++;if(['BoxGeometry','CylinderGeometry','ConeGeometry'].includes(mesh.geometry.type))primitives++;}
      });
      return {id:object.state.id,asset:target?.asset,resolved:Boolean(target?.resolvedSize),meshes,primitives,
        ...object.mesh.userData.ovenPhysics};
    });
    const wildlifePresentationDiagnostics=this.wildlifePresentation.getDiagnosticsSummary();
    ui.world.dataset.wildlifeRaccoonPending=String(wildlifePresentationDiagnostics.pending);
    ui.world.dataset.wildlifeRaccoonReady=String(wildlifePresentationDiagnostics.ready);
    ui.world.dataset.wildlifeRaccoonFailed=String(wildlifePresentationDiagnostics.failed);
    ui.world.dataset.wildlifeRaccoonCount=String(wildlifePresentationDiagnostics.count);
    ui.world.dataset.wildlifeVisuals=JSON.stringify([...this.wildlife.values()].filter(animal=>!animal.removed).map(animal=>{
      const presentationVisual=this.wildlifePresentation.getObject(animal.state.id);
      const visual=animal.state.species==='raccoon'
        ? presentationVisual
        : animal.mesh;
      let bones=0;
      let pose:unknown[]=[];
      if(visual){
        visual.traverse(node=>{
          if((node as THREE.Bone).isBone){
            bones++;
            const bone=node as THREE.Bone;
            pose.push(...bone.position.toArray(),...bone.quaternion.toArray(),...bone.scale.toArray());
          }
        });
      }
      const ready=animal.state.species==='raccoon'
        ? this.wildlifePresentation.getDiagnostics().some(item=>item.id===animal.state.id&&item.status==='ready')
        : (()=>{let meshes=0;animal.mesh.traverse(node=>{if((node as THREE.Mesh).isMesh)meshes++;});return meshes>0;})();
      return {
        id:animal.state.id,
        species:animal.state.species,
        position:{x:animal.mesh.position.x,z:animal.mesh.position.z},
        heading:animal.mesh.rotation.y,
        ready,
        meshes:visual?(()=>{let count=0;visual.traverse(node=>{if((node as THREE.Mesh).isMesh)count++;});return count;})():0,
        bones,
        action:animal.state.currentAction,
        pose
      };
    }));
    ui.world.dataset.bakingOvens=JSON.stringify(ovens);
    ui.world.dataset.portableObjects=JSON.stringify(this.portables.diagnostics());
    const waterPatches=[...this.objects.values()].filter(object=>object.state.kind==='water_patch').map(object=>{
      const target=this.visualTargets.find(candidate=>candidate.group===object.mesh&&candidate.asset===WATER_PATCH_ASSET);
      let meshes=0,primitives=0,materials=0,maxMetalness=0,minWaterLuminance=1;
      object.mesh.traverse(child=>{
        const mesh=child as THREE.Mesh;
        if(!mesh.isMesh)return;
        meshes++;if(['BoxGeometry','CylinderGeometry','ConeGeometry','PlaneGeometry'].includes(mesh.geometry.type))primitives++;
        for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
          if(!(material instanceof THREE.MeshStandardMaterial))continue;
          materials++;maxMetalness=Math.max(maxMetalness,material.metalness);
          const color=material.color;minWaterLuminance=Math.min(minWaterLuminance,.2126*color.r+.7152*color.g+.0722*color.b);
        }
      });
      return {
        id:object.state.id,chunkId:object.state.chunkId??null,name:object.state.name,
        position:{...object.state.position},asset:target?.asset,resolved:Boolean(target?.resolvedSize),
        resolvedSize:target?.resolvedSize??null,surfaceY:object.mesh.position.y,meshes,primitives,materials,maxMetalness,minWaterLuminance,
        capabilities:object.state.capabilities??[],resourceAmount:object.state.resourceAmount??null
      };
    });
    ui.world.dataset.waterPatches=JSON.stringify(waterPatches);
    ui.world.dataset.coarseMarkers=JSON.stringify(this.coarseWorld.presentationStatus());
    const treeEvidence=[...this.objects.values()].filter(object=>object.state.kind==='tree').map(object=>({
      id:object.state.id,position:object.state.position,...object.mesh.userData.treePhysics,
      height:this.visualTargets.find(target=>target.group===object.mesh)?.resolvedSize?.y
    }));
    const homeBuildings=[...this.objects.values()].filter(object=>object.state.kind==='building'&&!object.state.chunkId).map(object=>({
      id:object.state.id,center:{x:object.mesh.position.x,z:object.mesh.position.z},frontage:object.state.position,
      blockedAtCenter:this.physics.isBlocked(object.mesh.position.x,object.mesh.position.z,.3),
      ownTrigger:this.physics.overlappingTriggers(object.state.position).some(trigger=>trigger.id===`object-trigger:${object.state.id}`)
    }));
    ui.world.dataset.homeBuildingAnchors=JSON.stringify(homeBuildings);
    const soleEvidence=[...this.npcs.values()].filter(agent=>agent.soles).map(agent=>({
      id:agent.state.id,asset:agent.characterAsset,minimumPlayerSeparation:npcPlayerSeparation(agent.characterAsset),
      headYaw:agent.mesh.rotation.y,workApproach:agent.task?.approach,activePath:agent.pathIndex<agent.path.length,headEnvelope:characterHeadEnvelope(agent.characterAsset),
      playerHeadClearance:this.cameraMode==='firstPerson'?playerHeadClearance(agent.characterAsset,agent.mesh.position,agent.mesh.rotation.y,this.playerPosition):null,
      animation:agent.activeAnimation,vertices:agent.soles!.vertexCount,
      ground:this.groundHeightAt(agent.mesh.position.x,agent.mesh.position.z),
      sole:agent.soles!.minimumWorldY(),position:agent.state.position
    }));
    ui.world.dataset.treePresentation=JSON.stringify(treeEvidence);
    ui.world.dataset.characterSoles=JSON.stringify(soleEvidence);
    ui.world.dataset.shadowView=JSON.stringify(this.sunShadow.diagnostics());
    ui.world.dataset.playerBodyPresent=String(this.physicsDynamicColliders().some(body=>body.id==='player'));
    ui.world.dataset.cameraMode=this.cameraMode;
    ui.world.dataset.discoveredChunks=String(world.chunks);
    ui.world.dataset.materializedChunks=String(world.materializedChunks);
    ui.world.dataset.coarseDecidedChunks=String(world.decidedChunks);
    ui.world.dataset.coarseLastSource=world.lastSource;
    ui.world.dataset.coarseLastBatchSize=String(world.lastBatchSize);
    ui.world.dataset.coarseRequestTimeouts=String(world.requestTimeouts);
    ui.world.dataset.physicsBodies=String(activePhysicsBodies);
    ui.world.dataset.terrainSurfaces=String(physicsStats.terrainSurfaces);
    ui.world.dataset.playerX=this.playerPosition.x.toFixed(4);
    ui.world.dataset.playerZ=this.playerPosition.z.toFixed(4);
    ui.world.dataset.playerGroundingError=playerGroundingError.toFixed(5);
    ui.world.dataset.npcGroundingMaxError=npcGroundingMaxError.toFixed(5);
    ui.world.dataset.wildlifeGroundingMaxError=wildlifeGroundingMaxError.toFixed(5);
    ui.world.dataset.buildingVisualTargets=String(buildingTargets.length);
    ui.world.dataset.buildingVisualMinHeight=buildingMinHeight.toFixed(4);
    ui.world.dataset.buildingVisualMaxBoundsError=buildingMaxBoundsError.toFixed(5);
    ui.world.dataset.wellVisualWidth=wellVisualSize?.x.toFixed(4)??'NaN';
    ui.world.dataset.wellVisualHeight=wellVisualSize?.y.toFixed(4)??'NaN';
    ui.world.dataset.wellVisualDepth=wellVisualSize?.z.toFixed(4)??'NaN';
    ui.world.dataset.semanticLicensedTargets=String(semanticLicensedObjects.length);
    ui.world.dataset.semanticLicensedResolved=String(semanticLicensedResolved);
    ui.world.dataset.semanticPrimitiveMeshes=String(semanticPrimitiveMeshes);
    ui.world.dataset.movableBodies=String(movableBodies.length);
    ui.world.dataset.cartX=townCart?.state.position.x.toFixed(4)??'NaN';
    ui.world.dataset.cartZ=townCart?.state.position.z.toFixed(4)??'NaN';
    ui.world.dataset.cartVisualChildren=String(townCart?.mesh.children.length??0);
    ui.world.dataset.movableDirty=String(this.movableDirty);
    ui.world.dataset.persistenceSavePending=String(this.persistenceSaveInFlight||this.persistenceSaveQueued);
    ui.world.dataset.persistenceRevision=String(this.persistenceRevision);
    ui.world.dataset.persistenceConflict=String(this.persistenceConflict);
    ui.world.dataset.assetFailures=String(this.assetLoadFailures.length);
    ui.world.dataset.licensedVisualTargets=String(this.visualTargets.length);
    ui.world.dataset.licensedVisualsResolved=String(this.visualTargets.filter(target=>target.group.children.length>0).length);
    ui.world.textContent=`世界 已发现 ${world.chunks} · 活动 ${world.activeChunks}@${world.activeCenter} · 细化 ${world.materializedChunks} · 物理 ${activePhysicsBodies} bodies / ${physicsStats.staticColliders} static / ${physicsStats.triggers} triggers / ${physicsStats.terrainSurfaces} terrain · 野生动物 ${world.wildlifePopulation.toFixed(0)} · 植物量 ${world.plantBiomass.toFixed(0)} · 食物网 ${world.trophicPrimary.toFixed(2)}→${world.trophicHerbivory.toFixed(2)}→${world.trophicPredation.toFixed(2)} · 竞争 ${world.nicheCompetition.toFixed(0)} (${world.strongestCompetition}) · 疾病压力 ${world.wildlifeDiseasePressure.toFixed(0)} (${world.strongestDiseaseTransmission}) · 捕食压力 ${world.wildlifePredatorPressure.toFixed(0)} (${world.strongestPredatorPressure}) · chunk决策 ${world.decidedChunks}/${world.chunks} · region ${world.regionDecisions} · world ${world.worldPriority}/${world.worldConnectivity}/${world.worldGrowth} · 流 ${world.recentFlowCount} · ${world.pending?'批量决策中':world.lastSource.toUpperCase()} · 生态 ${world.avgEcology.toFixed(0)} · 繁荣 ${world.avgProsperity.toFixed(0)} · ${world.lastFlowSummary}`;
    ui.clock.textContent=`Day ${this.day} · ${this.gameTimeText()} · ${i18n.t(`season.${this.worldSeason()}`)} · ${i18n.t(`weather.${this.weather}`)}`;
    ui.inv.textContent=this.cameraMode==='god'?i18n.t('observer'):`背包 🍎${this.playerInventory.apple} 🍞${this.playerInventory.bread} 🪵${this.playerInventory.wood} 🌾${this.playerInventory.grain} 🥣${this.playerInventory.flour} 💧${this.playerInventory.water} 🪵${this.playerInventory.plank} 🪨${this.playerInventory.stone} 🔧${this.playerInventory.tool} ◉${this.playerInventory.coin}`;
    const entity=this.cameraMode==='god'?(this.selectedEntity||this.hoverEntity):this.hoverEntity;
    if(entity?.type==='npc'){
      const a=this.npcs.get(entity.id)!;const n=a.state;const d=a.lastDecision;
      const target=d?.targetNpcId?this.npcs.get(d.targetNpcId)?.state.name||d.targetNpcId:d?.targetObjectId?this.objects.get(d.targetObjectId)?.state.name||d.targetObjectId:'—';
      const inv=n.inventory.filter(x=>x.count>0).map(x=>`${this.itemName(x.kind)}×${x.count}`).join('、')||'空';
      const memories=n.memories.slice(-3).reverse().map(m=>`<div class="memory">• ${this.escape(m.summary)}</div>`).join('')||'<span>暂无显著记忆</span>';
      ui.npc.classList.remove('hidden');ui.npc.innerHTML=`<div class="npc-head"><b>${this.escape(n.name)}</b><span>${n.role}</span></div><div>心情 ${n.mood} · 饥饿 ${n.hunger.toFixed(0)} · 精力 ${n.energy.toFixed(0)} · 社交 ${n.social.toFixed(0)}</div><div>当前行为 <b>${n.currentAction}</b> · 金钱 ${n.money}</div><div>背包 ${inv}</div><div class="npc-goal">${this.escape(n.goal)}</div>${d?`<div class="decision"><b>最近决策</b> ${d.action} → ${this.escape(String(target))}<br>${d.source.toUpperCase()} · confidence ${(d.confidence*100).toFixed(0)}% · ${d.stateShift}${d.socialIntent?` · ${d.socialIntent}`:''}<br><span>${this.escape(d.reasonCode)}</span></div>`:'<div class="decision"><span>等待首次决策…</span></div>'}<div class="memories"><b>短期记忆</b>${memories}</div>`;
    } else if(entity?.type==='wildlife'){
      const a=this.wildlife.get(entity.id);
      if(a){
        const s=a.state;
        ui.npc.classList.remove('hidden');
        const lineage=this.wildlifeLineage.get(s.id);
        const coarsePopulation=this.coarseWorld.chunks.get(s.chunkId)?.wildlife?.find(entry=>entry.species===s.species);
        ui.npc.innerHTML=`<div class="npc-head"><b>${this.escape(this.wildlifeName(s.species))}</b><span>${s.sex} · G${s.generation}</span></div>${(()=>{const profile=wildlifeSpeciesProfile(s.species);return `<div>family ${profile.organismFamily} · form ${profile.form.kind}${profile.archetypeId?` · archetype ${this.escape(profile.archetypeId)}`:''} · movement ${profile.movement.mode}/${profile.movement.gait} · accel ${profile.movement.accelerationRate.toFixed(1)}×/s · turn ${profile.movement.turnRate.toFixed(1)}rad/s</div><div>capabilities ${profile.capabilities.map(action=>this.escape(action)).join(' / ')}</div>`;})()}${(()=>{const d=normalizeWildlifeDomestication(s.species,s.domestication);return d?`<div>${i18n.t('domestication.progress')} ${d.tameProgress.toFixed(0)}/100 · ${i18n.t('domestication.owner')} ${this.escape(d.ownerId||i18n.t('domestication.unowned'))} · ${i18n.t('domestication.command')} ${i18n.t(`domestication.command.${d.command}`)} · ${i18n.t('domestication.breeding')} ${i18n.t(d.breedingAllowed?'domestication.breeding.on':'domestication.breeding.off')}</div>`:``;})()}<div>${i18n.t('wildlife.health')} ${s.health.toFixed(0)} · ${i18n.t('wildlife.hunger')} ${s.hunger.toFixed(0)} · ${i18n.t('wildlife.thirst')} ${s.thirst.toFixed(0)} · ${i18n.t('wildlife.energy')} ${s.energy.toFixed(0)}</div><div>${i18n.t('wildlife.action')} <b>${s.currentAction}</b> · ${i18n.t('wildlife.age')} ${s.ageDays.toFixed(0)}d · ${i18n.t('wildlife.disease')} ${(s.diseaseLoad||0).toFixed(0)}</div><div>${s.motherId?`mother ${this.escape(s.motherId)} · `:''}${s.fatherId?`father ${this.escape(s.fatherId)} · `:''}${s.pregnantUntilDay?`pregnant → Day ${s.pregnantUntilDay.toFixed(1)}`:''}${lineage?` · offspring ${lineage.offspringCount}`:''}</div><div>speed ${s.traits.speed.toFixed(2)} · size ${s.traits.size.toFixed(2)} · fertility ${s.traits.fertility.toFixed(2)} · wariness ${s.traits.wariness.toFixed(2)}</div>${s.phenotype?`<div>morph L ${s.phenotype.morphology.bodyLength.toFixed(2)} · H ${s.phenotype.morphology.bodyHeight.toFixed(2)} · leg ${s.phenotype.morphology.legLength.toFixed(2)} · head ${s.phenotype.morphology.headScale.toFixed(2)} · behavior forage ${s.phenotype.behavior.forageDrive.toFixed(2)} · migrate ${s.phenotype.behavior.migrationDrive.toFixed(2)} · risk ${s.phenotype.behavior.riskTolerance.toFixed(2)} · recover ${s.phenotype.behavior.recoveryDrive.toFixed(2)}</div><div>${(()=>{const fn=wildlifeFunctionalPhenotype(s.phenotype);return `function speed ×${fn.movementSpeedMultiplier.toFixed(2)} · move cost ×${fn.movementEnergyMultiplier.toFixed(2)} · maintenance ×${fn.maintenanceMultiplier.toFixed(2)} · forage ×${fn.forageEfficiency.toFixed(2)} · rest ×${fn.recoveryEfficiency.toFixed(2)}`;})()}</div>`:''}${s.organismGenome?`<div>family ${s.organismGenome.family} · niche grass ×${s.organismGenome.niche.grass.toFixed(2)} shrub ×${s.organismGenome.niche.shrub.toFixed(2)} fruit ×${s.organismGenome.niche.fruit.toFixed(2)} crop ×${s.organismGenome.niche.crop.toFixed(2)}</div><div>${(()=>{const locomotion=wildlifeOrganismLocomotion(s.organismGenome!);return `genome locomotion stride ×${s.organismGenome!.locomotion.stride.toFixed(2)} · endurance ×${s.organismGenome!.locomotion.endurance.toFixed(2)} · speed ×${locomotion.speedMultiplier.toFixed(2)} · energy ×${locomotion.energyMultiplier.toFixed(2)}`;})()}</div>`:'' }${coarsePopulation?`<div>${i18n.t('evolution.competition')} ${(coarsePopulation.competitionPressure||0).toFixed(0)} · ${i18n.t('evolution.diseasePressure')} ${(this.coarseWorld.chunks.get(s.chunkId)?.wildlifeDisease?.speciesPressure[s.species]??coarsePopulation.diseaseLoad??0).toFixed(0)} · ${i18n.t('evolution.predatorPressure')} ${(this.coarseWorld.chunks.get(s.chunkId)?.wildlifePredatorPressure?.speciesPressure[s.species]??coarsePopulation.predatorPressure??0).toFixed(0)} · K ${coarsePopulation.carryingCapacity.toFixed(1)}</div>`:''}${s.representedPopulation?`<div>${i18n.t('evolution.representedPopulation')} ${s.representedPopulation.toFixed(2)}</div>`:''}${s.targetChunkId?`<div>${i18n.t('evolution.migrationTarget')} ${this.escape(s.targetChunkId)}</div>`:''}`;
      }else ui.npc.classList.add('hidden');
    } else if(entity?.type==='object'){
      const o=this.objects.get(entity.id)!.state;const caps=(o.capabilities||[]).map(x=>this.interactionLabel(x)).join(' / ')||'查看';const stored=o.storage?.filter(x=>x.count>0).map(x=>`${this.itemName(x.kind)}×${x.count}`).join('、')||'';ui.npc.classList.remove('hidden');ui.npc.innerHTML=`<div class="npc-head"><b>${this.escape(o.name)}</b><span>${o.kind}</span></div><div>位置 ${o.position.x.toFixed(1)}, ${o.position.z.toFixed(1)}</div><div>标签 ${o.tags.map(x=>this.escape(x)).join(' / ')}</div><div>交互 ${this.escape(caps)}</div>${stored?`<div>存储 ${this.escape(stored)}</div>`:''}${o.item?`<div>资源 ${this.itemName(o.item)}</div>`:''}`;
    } else ui.npc.classList.add('hidden');
    this.renderEvolutionPanel();
    ui.log.innerHTML=this.logs.slice(-7).map(x=>`<div>${this.escape(x)}</div>`).join('');
  }

  updateSpeech() {
    const viewport={width:innerWidth,height:innerHeight};
    for(const a of this.npcs.values()){
      if(this.cameraMode==='god'){
        a.nameEl.classList.remove('hidden');
        a.nameEl.textContent=`${a.state.name} · ${a.state.currentAction}`;
        const anchor=characterOverlay(this.camera,a.mesh.position,viewport,{width:a.nameEl.offsetWidth,height:a.nameEl.offsetHeight},1.82,1);
        if(anchor){a.nameEl.style.left=`${anchor.left}px`;a.nameEl.style.top=`${anchor.top}px`;}
        else a.nameEl.classList.add('hidden');
      }else a.nameEl.classList.add('hidden');
      const speech=a.speech;
      if(!speech||now()>speech.until){a.speechEl.classList.add('hidden');continue;}
      a.speechEl.classList.remove('hidden');
      a.speechEl.textContent=speech.text;
      const anchor=characterOverlay(this.camera,a.mesh.position,viewport,{width:a.speechEl.offsetWidth,height:a.speechEl.offsetHeight});
      if(anchor){a.speechEl.style.left=`${anchor.left}px`;a.speechEl.style.top=`${anchor.top}px`;}
      else a.speechEl.classList.add('hidden');
    }
  }

  updateSelectionVisuals() {
    if(this.cameraMode!=='god'||!this.selectedEntity){this.selectionRing.visible=false;this.pathLine.visible=false;return;}
    const p=this.entityPosition(this.selectedEntity);if(!p){this.selectionRing.visible=false;this.pathLine.visible=false;return;}
    this.selectionRing.visible=true;this.selectionRing.position.set(p.x,.04,p.z);
    if(this.selectedEntity.type==='npc'){
      const a=this.npcs.get(this.selectedEntity.id)!;const remaining=a.path.slice(a.pathIndex);
      if(remaining.length){const pts=[new THREE.Vector3(a.mesh.position.x,.09,a.mesh.position.z),...remaining.map(x=>new THREE.Vector3(x.x,.09,x.z))];this.pathLine.geometry.dispose();this.pathLine.geometry=new THREE.BufferGeometry().setFromPoints(pts);this.pathLine.visible=true;}else this.pathLine.visible=false;
    }else if(this.selectedEntity.type==='wildlife'){
      const a=this.wildlife.get(this.selectedEntity.id);
      const remaining=a?a.path.slice(a.pathIndex):[];
      if(a&&remaining.length){const pts=[new THREE.Vector3(a.mesh.position.x,.09,a.mesh.position.z),...remaining.map(x=>new THREE.Vector3(x.x,.09,x.z))];this.pathLine.geometry.dispose();this.pathLine.geometry=new THREE.BufferGeometry().setFromPoints(pts);this.pathLine.visible=true;}else this.pathLine.visible=false;
    }else this.pathLine.visible=false;
  }

  applyBudgetPreset(name:string) {
    const presets:Record<string,{calls:number;minute:number;hour:number;day:number;usd:number;confidence:number;cache:number}>={
      economy:{calls:24,minute:35_000,hour:250_000,day:1_200_000,usd:.06,confidence:.45,cache:6000},
      balanced:{calls:60,minute:120_000,hour:1_000_000,day:5_000_000,usd:.25,confidence:.35,cache:2500},
      quality:{calls:120,minute:300_000,hour:2_500_000,day:12_000_000,usd:.55,confidence:.25,cache:1000},
    };
    const p=presets[name]||presets.balanced;
    const set=(id:string,v:number)=>{const el=document.querySelector<HTMLInputElement>(id);if(el)el.value=String(v);};
    set('#budgetCallsMin',p.calls);set('#budgetTokensMin',p.minute);set('#budgetTokensHour',p.hour);set('#budgetTokensDay',p.day);
    set('#budgetUsdDay',p.usd);set('#budgetConfidence',p.confidence);set('#budgetCacheTtl',p.cache);
    void this.applyBudgetFromUi();
  }

  async applyBudgetFromUi() {
    const num=(id:string)=>Number(document.querySelector<HTMLInputElement>(id)?.value||0);
    const payload={
      maxCallsPerMinute:num('#budgetCallsMin'),
      maxInputTokensPerMinute:num('#budgetTokensMin'),
      maxInputTokensPerHour:num('#budgetTokensHour'),
      maxInputTokensPerDay:num('#budgetTokensDay'),
      maxUsdPerDay:num('#budgetUsdDay'),
      minConfidence:num('#budgetConfidence'),
      cacheTtlMs:num('#budgetCacheTtl'),
    };
    try{
      const r=await fetch('/api/decision/budget',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
      const out=await r.json();if(!r.ok)throw new Error(out.error||'budget update failed');
      this.renderBudget(out,true);this.toast(i18n.t('budget.updated'));
    }catch(e){this.toast(i18n.t('budget.failed',{error:e instanceof Error?e.message:String(e)}));}
  }

  renderBudget(budget:any,syncInputs=false) {
    if(!budget||budget.unavailable){ui.budgetLive.textContent='当前 provider 不提供 Jev token 预算。';return;}
    const t=budget.inputTokens||{},calls=budget.calls||{},cost=budget.estimatedUsd||{},cfg=budget.config||{};
    ui.budgetLive.innerHTML=`输入 tokens：分钟 <b>${Number(t.minute||0).toLocaleString()}</b> · 小时 <b>${Number(t.hour||0).toLocaleString()}</b> · 今日 <b>${Number(t.day||0).toLocaleString()}</b><br>估算今日费用 <b>${Number(cost.day||0).toFixed(4)}</b> · calls ${calls.minute||0}/min · NPC ${calls.npc||0} / 对话 ${calls.dialogue||0} / chunk ${calls.chunk||0} / region ${calls.region||0} / world ${calls.world||0} / wildlife ${calls.wildlife||0}<br>缓存命中 ${budget.cacheHits||0} · 预算阻断 ${budget.blocked||0} · 低置信回退 ${budget.lowConfidenceFallbacks||0}`;
    if(syncInputs&&!document.activeElement?.matches?.('#jevBudgetPanel input')){
      const set=(id:string,v:unknown)=>{const el=document.querySelector<HTMLInputElement>(id);if(el&&v!==undefined)el.value=String(v);};
      set('#budgetCallsMin',cfg.maxCallsPerMinute);set('#budgetTokensMin',cfg.maxInputTokensPerMinute);set('#budgetTokensHour',cfg.maxInputTokensPerHour);
      set('#budgetTokensDay',cfg.maxInputTokensPerDay);set('#budgetUsdDay',cfg.maxUsdPerDay);set('#budgetConfidence',cfg.minConfidence);set('#budgetCacheTtl',cfg.cacheTtlMs);
    }
  }

  async refreshHealth(){this.lastHealthPoll=now();try{const r=await fetch('/api/health');const j=await r.json();const d=j.decision||{};const s=d.status||{};this.decisionProvider=String(d.active||'unknown');this.decisionCalls=Number(s.calls||0);const local=this.decisionProvider==='fallback';const configured=s.configured!==false;ui.decision.textContent=local?'Fallback · 本地规则':configured?`${this.decisionProvider.toUpperCase()} · calls ${this.decisionCalls} · ${s.lastLatencyMs||0}ms`:`${this.decisionProvider.toUpperCase()} 未配置 · 安全回退`;const endpoint=s.endpoint?` · endpoint ${this.escape(String(s.endpoint))}`:'';const limiter=s.limiter?`<br><b>限流</b> ${s.limiter.usedLastMinute||0}/${s.limiter.max||'∞'} calls/min`:'';ui.adminStatus.innerHTML=`<b>Decision provider</b> ${this.escape(this.decisionProvider)}${endpoint}<br><b>调用</b> ${s.calls||0} · failures ${s.failures||0}${s.inputTokens!==undefined?` · input tokens ${Number(s.inputTokens).toLocaleString()}`:''}<br><b>语料</b> ${j.dialogue?.total||0} 条（完整 ${j.dialogue?.lines||0} / 片段 ${j.dialogue?.fragments||0}）${limiter}`;this.renderBudget(s.budget,true);}catch{ui.decision.textContent=i18n.t('backend.offline');}}

  coarseWildlifePopulation(species:WildlifeSpecies) {
    let total=0;
    for(const chunk of this.coarseWorld.chunks.values()){
      total+=chunk.wildlife?.find(population=>population.species===species)?.count||0;
    }
    return total;
  }

  coarseWildlifeCompetition(species:WildlifeSpecies) {
    let weighted=0,total=0;
    for(const chunk of this.coarseWorld.chunks.values()){
      const population=chunk.wildlife?.find(entry=>entry.species===species);
      if(!population)continue;
      const weight=Math.max(.01,population.count);
      weighted+=(population.competitionPressure||0)*weight;
      total+=weight;
    }
    return total>0?weighted/total:0;
  }

  renderEvolutionPanel() {
    if(this.cameraMode!=='god'){
      ui.evolution.classList.add('hidden');
      return;
    }
    ui.evolution.classList.remove('hidden');
    const stats=this.evolutionStatistics();
    const coevolution=this.coevolutionStatistics();
    const interactionSelection=this.interactionSelectionStatistics();
    const interactionNetwork=this.activeInteractionNetwork();
    const active=stats.filter(entry=>entry.historicalPopulation>0);
    const trait=(value:number)=>Number.isFinite(value)?value.toFixed(2):'0.00';
    const association=(value:number|null)=>value===null?'—':value.toFixed(2);
    const percent=(value:number)=>`${(value*100).toFixed(0)}%`;
    const cards=active.map(entry=>`
      <div class="evo-card">
        <div class="evo-head"><b>${this.escape(this.wildlifeName(entry.species))}</b><span>world ~${this.coarseWildlifePopulation(entry.species).toFixed(0)}</span></div>
        <div>${i18n.t('evolution.tracked')} ${entry.livingPopulation}/${entry.historicalPopulation} · G${entry.generationMean.toFixed(1)}→G${entry.generationMax} · ${i18n.t('evolution.competition')} ${this.coarseWildlifeCompetition(entry.species).toFixed(0)}</div>
        <div>${i18n.t('evolution.births')} ${entry.births} · ${i18n.t('evolution.deaths')} ${entry.deaths} · ${i18n.t('evolution.lifespan')} ${entry.lifespanMean.toFixed(1)}d</div>
        <div>${i18n.t('evolution.reproduction')} ${percent(entry.survivalToReproductionRate)} · offspring ${entry.offspringMean.toFixed(2)} · successful ${entry.reproductiveSuccess.toFixed(2)}</div>
        <div class="evo-traits">μ speed ${trait(entry.traitMean.speed)} · size ${trait(entry.traitMean.size)} · fertility ${trait(entry.traitMean.fertility)} · wariness ${trait(entry.traitMean.wariness)}</div>
        <div class="evo-traits">σ² speed ${trait(entry.traitVariance.speed)} · size ${trait(entry.traitVariance.size)} · fertility ${trait(entry.traitVariance.fertility)} · wariness ${trait(entry.traitVariance.wariness)}</div>
        <div class="evo-traits">Δ/G speed ${trait(entry.traitTrendPerGeneration.speed)} · size ${trait(entry.traitTrendPerGeneration.size)} · fertility ${trait(entry.traitTrendPerGeneration.fertility)} · wariness ${trait(entry.traitTrendPerGeneration.wariness)}</div>
        ${entry.phenotype.mean?`<div class="evo-traits"><b>${i18n.t('evolution.phenotype')}</b> n=${entry.phenotype.sampleSize} / comparable ${entry.phenotype.comparableSamples} · birth ${entry.phenotype.birthTrackedSamples} · founder ${entry.phenotype.founderSeedSamples} · legacy ${entry.phenotype.legacyUpgradeSamples} · ${i18n.t('evolution.morphology')} L ${trait(entry.phenotype.mean.morphology.bodyLength)} H ${trait(entry.phenotype.mean.morphology.bodyHeight)} leg ${trait(entry.phenotype.mean.morphology.legLength)} head ${trait(entry.phenotype.mean.morphology.headScale)} tail ${trait(entry.phenotype.mean.morphology.tailScale)}</div>
          <div class="evo-traits">${i18n.t('evolution.behaviorGenes')} forage ${trait(entry.phenotype.mean.behavior.forageDrive)} migrate ${trait(entry.phenotype.mean.behavior.migrationDrive)} risk ${trait(entry.phenotype.mean.behavior.riskTolerance)} recover ${trait(entry.phenotype.mean.behavior.recoveryDrive)}</div>
          ${entry.phenotype.trendPerGeneration?`<div class="evo-traits">phenotype Δ/G bodyL ${trait(entry.phenotype.trendPerGeneration.morphology.bodyLength)} leg ${trait(entry.phenotype.trendPerGeneration.morphology.legLength)} migrate ${trait(entry.phenotype.trendPerGeneration.behavior.migrationDrive)} risk ${trait(entry.phenotype.trendPerGeneration.behavior.riskTolerance)}</div>`:''}
          ${entry.phenotype.breederDifferential?`<div class="evo-traits">${i18n.t('evolution.breederDelta')} bodyL ${trait(entry.phenotype.breederDifferential.morphology.bodyLength)} leg ${trait(entry.phenotype.breederDifferential.morphology.legLength)} forage ${trait(entry.phenotype.breederDifferential.behavior.forageDrive)} risk ${trait(entry.phenotype.breederDifferential.behavior.riskTolerance)}</div>`:''}`:''}
        ${entry.organismGenome.mean?`<div class="evo-traits"><b>${i18n.t('evolution.organismGenome')}</b> ${entry.organismGenome.family||'—'} · n=${entry.organismGenome.sampleSize} / comparable ${entry.organismGenome.comparableSamples} · birth ${entry.organismGenome.birthTrackedSamples} · founder ${entry.organismGenome.founderSeedSamples} · legacy ${entry.organismGenome.legacyUpgradeSamples}<br>μ niche g ${trait(entry.organismGenome.mean.niche.grass)} s ${trait(entry.organismGenome.mean.niche.shrub)} f ${trait(entry.organismGenome.mean.niche.fruit)} c ${trait(entry.organismGenome.mean.niche.crop)} · stride ${trait(entry.organismGenome.mean.locomotion.stride)} endurance ${trait(entry.organismGenome.mean.locomotion.endurance)}${entry.organismGenome.trendPerGeneration?`<br>Δ/G niche g ${trait(entry.organismGenome.trendPerGeneration.niche.grass)} s ${trait(entry.organismGenome.trendPerGeneration.niche.shrub)} f ${trait(entry.organismGenome.trendPerGeneration.niche.fruit)} c ${trait(entry.organismGenome.trendPerGeneration.niche.crop)} · stride ${trait(entry.organismGenome.trendPerGeneration.locomotion.stride)} endurance ${trait(entry.organismGenome.trendPerGeneration.locomotion.endurance)}`:'' }${entry.organismGenome.breederDifferential?`<br>${i18n.t('evolution.breederDelta')} niche g ${trait(entry.organismGenome.breederDifferential.niche.grass)} s ${trait(entry.organismGenome.breederDifferential.niche.shrub)} f ${trait(entry.organismGenome.breederDifferential.niche.fruit)} c ${trait(entry.organismGenome.breederDifferential.niche.crop)} · stride ${trait(entry.organismGenome.breederDifferential.locomotion.stride)} endurance ${trait(entry.organismGenome.breederDifferential.locomotion.endurance)}`:''}</div>`:'' }
        ${entry.phenotypeBiomeFitness.filter(fitness=>fitness.sampleSize>=3).slice(0,3).map(fitness=>`
          <div class="evo-selection">
            <b>${i18n.t('evolution.phenotypeFitness')} · ${this.escape(fitness.biome)}</b> · n=${fitness.sampleSize} · eligible ${fitness.reproductionEligibleSamples} · dead ${fitness.lifespanSamples} · obs ${fitness.observedExposureDaysMean.toFixed(2)}d
            <div>r(reproduce) leg ${association(fitness.reproductionAssociation.morphology.legLength)} · bodyL ${association(fitness.reproductionAssociation.morphology.bodyLength)} · forage ${association(fitness.reproductionAssociation.behavior.forageDrive)} · risk ${association(fitness.reproductionAssociation.behavior.riskTolerance)}</div>
            <div>r(offspring) leg ${association(fitness.offspringAssociation.morphology.legLength)} · head ${association(fitness.offspringAssociation.morphology.headScale)} · forage ${association(fitness.offspringAssociation.behavior.forageDrive)} · recover ${association(fitness.offspringAssociation.behavior.recoveryDrive)}</div>
            <div>r(lifespan) leg ${association(fitness.lifespanAssociation.morphology.legLength)} · bodyH ${association(fitness.lifespanAssociation.morphology.bodyHeight)} · risk ${association(fitness.lifespanAssociation.behavior.riskTolerance)} · recover ${association(fitness.lifespanAssociation.behavior.recoveryDrive)}</div>
            ${fitness.breederDifferential?`<div class="evo-traits">${i18n.t('evolution.breederDelta')} bodyL ${trait(fitness.breederDifferential.morphology.bodyLength)} · leg ${trait(fitness.breederDifferential.morphology.legLength)} · head ${trait(fitness.breederDifferential.morphology.headScale)} · forage ${trait(fitness.breederDifferential.behavior.forageDrive)} · risk ${trait(fitness.breederDifferential.behavior.riskTolerance)}</div>`:''}
          </div>`).join('')}
        <div>${i18n.t('evolution.mortality')} · ${i18n.t('evolution.predation')} ${entry.mortality.predation} · ${i18n.t('evolution.disease')} ${entry.mortality.disease} · ${i18n.t('evolution.starvation')} ${entry.mortality.starvation} · ${i18n.t('evolution.dehydration')} ${entry.mortality.dehydration} · ${i18n.t('evolution.senescence')} ${entry.mortality.senescence}</div>
        ${entry.realizedPredation.huntAttempts+entry.realizedPredation.fleeAttempts+entry.realizedPredation.attacksReceived>0?`
          <div><b>${i18n.t('evolution.realizedPredation')}</b> · ${i18n.t('evolution.huntOutcome')} ${entry.realizedPredation.huntHits}/${entry.realizedPredation.kills}/${entry.realizedPredation.huntAttempts} · ${i18n.t('evolution.escapeOutcome')} ${entry.realizedPredation.successfulEscapes}/${entry.realizedPredation.fleeAttempts} · ${i18n.t('evolution.attackSurvival')} ${entry.realizedPredation.survivedAttacks}/${entry.realizedPredation.attacksReceived}</div>
          ${entry.realizedPredation.pairs.slice(0,4).map(pair=>this.renderPredationPairEvidence(pair)).join('')}
        `:''}
        ${entry.biomeSelection.slice(0,3).map(selection=>`
          <div class="evo-selection">
            <b>${i18n.t('evolution.origin')} · ${this.escape(selection.biome)}</b> · n=${selection.population} · G=${selection.generationsObserved} · breeders ${selection.breeders}
            <div>wariness ${selection.normalizedSelectionDifferential.wariness>=0?'+':''}${trait(selection.normalizedSelectionDifferential.wariness)}σ · ${percent(selection.selectionConsistency.wariness)} / Gsel ${selection.comparableSelectionGenerations.wariness.toFixed(0)} · ${i18n.t(`evolution.signal.${selection.signal.wariness}`)}</div>
            <div>size ${selection.normalizedSelectionDifferential.size>=0?'+':''}${trait(selection.normalizedSelectionDifferential.size)}σ · ${percent(selection.selectionConsistency.size)} / Gsel ${selection.comparableSelectionGenerations.size.toFixed(0)} · ${i18n.t(`evolution.signal.${selection.signal.size}`)}</div>
            <div class="evo-traits">${i18n.t('evolution.habitat')} ecology ${selection.habitatMean.ecology.toFixed(0)} · food ${selection.habitatMean.food.toFixed(0)} · water ${selection.habitatMean.water.toFixed(0)} · danger ${selection.habitatMean.danger.toFixed(0)} · ${i18n.t('evolution.competition')} ${Number(selection.habitatMean.competitionPressure||0).toFixed(0)} · ${i18n.t('evolution.seasonalSuitability')} ${Number(selection.habitatMean.seasonalSuitability||0).toFixed(0)} · ${i18n.t('evolution.diseasePressure')} ${Number(selection.habitatMean.diseasePressure||0).toFixed(0)} · ${i18n.t('evolution.predatorPressure')} ${Number(selection.habitatMean.predatorPressure||0).toFixed(0)}</div>
          </div>`).join('')}
        ${entry.lifetimeBiomeSelection.slice(0,3).map(selection=>`
          <div class="evo-selection">
            <b>${i18n.t('evolution.lifetime')} · ${this.escape(selection.biome)}</b> · n=${selection.population} · G=${selection.generationsObserved} · obs ${selection.observedExposureDaysMean.toFixed(2)}d
            <div>wariness ${selection.normalizedSelectionDifferential.wariness>=0?'+':''}${trait(selection.normalizedSelectionDifferential.wariness)}σ · ${percent(selection.selectionConsistency.wariness)} / Gsel ${selection.comparableSelectionGenerations.wariness.toFixed(0)} · ${i18n.t(`evolution.signal.${selection.signal.wariness}`)}</div>
            <div>size ${selection.normalizedSelectionDifferential.size>=0?'+':''}${trait(selection.normalizedSelectionDifferential.size)}σ · ${percent(selection.selectionConsistency.size)} / Gsel ${selection.comparableSelectionGenerations.size.toFixed(0)} · ${i18n.t(`evolution.signal.${selection.signal.size}`)}</div>
            <div class="evo-traits">${i18n.t('evolution.exposure')} ecology ${selection.habitatMean.ecology.toFixed(0)} · food ${selection.habitatMean.food.toFixed(0)} · water ${selection.habitatMean.water.toFixed(0)} · danger ${selection.habitatMean.danger.toFixed(0)} · ${i18n.t('evolution.competition')} ${Number(selection.habitatMean.competitionPressure||0).toFixed(0)} · ${i18n.t('evolution.seasonalSuitability')} ${Number(selection.habitatMean.seasonalSuitability||0).toFixed(0)} · ${i18n.t('evolution.diseasePressure')} ${Number(selection.habitatMean.diseasePressure||0).toFixed(0)} · ${i18n.t('evolution.predatorPressure')} ${Number(selection.habitatMean.predatorPressure||0).toFixed(0)}</div>
          </div>`).join('')}
        ${entry.exposureFitness.filter(fitness=>fitness.sampleSize>=3).map(fitness=>{
          const label=fitness.dimension==='competitionPressure'?i18n.t('evolution.competition')
            :fitness.dimension==='seasonalSuitability'?i18n.t('evolution.seasonalSuitability')
            :fitness.dimension==='diseasePressure'?i18n.t('evolution.diseasePressure')
            :i18n.t('evolution.predatorPressure');
          const band=(name:'low'|'medium'|'high')=>fitness.bands.find(x=>x.band===name);
          const low=band('low'),mid=band('medium'),high=band('high');
          return `
          <div class="evo-selection">
            <b>${i18n.t('evolution.fitness')} · ${label}</b> · n=${fitness.sampleSize} · eligible ${fitness.reproductionEligibleSamples} · dead ${fitness.lifespanSamples} · obs ${fitness.observedExposureDaysMean.toFixed(2)}d
            <div>r(reproduce) ${fitness.reproductionAssociation===null?'—':fitness.reproductionAssociation.toFixed(2)} · r(offspring) ${fitness.offspringAssociation===null?'—':fitness.offspringAssociation.toFixed(2)} · r(lifespan) ${fitness.lifespanAssociation===null?'—':fitness.lifespanAssociation.toFixed(2)}</div>
            <div class="evo-traits">${i18n.t('evolution.low')} ${low?.eligiblePopulation||0}/${percent(low?.breederRate||0)} · ${i18n.t('evolution.medium')} ${mid?.eligiblePopulation||0}/${percent(mid?.breederRate||0)} · ${i18n.t('evolution.high')} ${high?.eligiblePopulation||0}/${percent(high?.breederRate||0)}</div>
            <div class="evo-traits">breeder μ ${fitness.breederExposureMean===null?'—':fitness.breederExposureMean.toFixed(1)} · non-breeder μ ${fitness.nonBreederExposureMean===null?'—':fitness.nonBreederExposureMean.toFixed(1)}</div>
          </div>`;
        }).join('')}
        ${entry.predatorSpecialization.filter(source=>source.sampleSize>=3).slice(0,4).map(source=>`
          <div class="evo-selection">
            <b>${i18n.t('evolution.predatorSources')} · ${this.escape(this.wildlifeName(source.predatorSpecies))}</b> · n=${source.sampleSize} · eligible ${source.reproductionEligibleSamples} · dead ${source.lifespanSamples} · μp ${source.pressureMean.toFixed(1)}
            <div>r(reproduce) ${source.reproductionAssociation===null?'—':source.reproductionAssociation.toFixed(2)} · r(offspring) ${source.offspringAssociation===null?'—':source.offspringAssociation.toFixed(2)} · r(lifespan) ${source.lifespanAssociation===null?'—':source.lifespanAssociation.toFixed(2)}</div>
            <div class="evo-traits">Δ breeder wariness ${source.selectionDifferential.wariness>=0?'+':''}${trait(source.selectionDifferential.wariness)} · size ${source.selectionDifferential.size>=0?'+':''}${trait(source.selectionDifferential.size)}</div>
          </div>`).join('')}
        ${entry.interactionSourceFitness.filter(source=>source.sampleSize>=3).slice(0,6).map(source=>`
          <div class="evo-selection">
            <b>${i18n.t('evolution.sourceEvidence')} · ${i18n.t(`evolution.interaction.${source.kind}`)} ← ${this.escape(this.wildlifeName(source.sourceSpecies))}</b> · n=${source.sampleSize} · eligible ${source.reproductionEligibleSamples} · dead ${source.lifespanSamples} · μp ${source.pressureMean.toFixed(1)}
            <div>r(reproduce) ${source.reproductionAssociation===null?'—':source.reproductionAssociation.toFixed(2)} · r(offspring) ${source.offspringAssociation===null?'—':source.offspringAssociation.toFixed(2)} · r(lifespan) ${source.lifespanAssociation===null?'—':source.lifespanAssociation.toFixed(2)}</div>
            <div class="evo-traits">breeder μ ${source.breederPressureMean===null?'—':source.breederPressureMean.toFixed(1)} · non-breeder μ ${source.nonBreederPressureMean===null?'—':source.nonBreederPressureMean.toFixed(1)} · Δ wariness ${source.selectionDifferential.wariness>=0?'+':''}${trait(source.selectionDifferential.wariness)} · size ${source.selectionDifferential.size>=0?'+':''}${trait(source.selectionDifferential.size)}</div>
          </div>`).join('')}
        ${entry.multifactorSelection.models.filter(model=>model.candidateFeatures>=2).map(model=>`
          <div class="evo-selection">
            <b>${i18n.t('evolution.multifactor')} · ${i18n.t(`evolution.outcome.${model.outcome}`)}</b> · ${model.estimable
              ?`n=${model.samples}/${model.baseSamples} · p=${model.selectedFeatures} · R² ${model.rSquared===null?'—':model.rSquared.toFixed(2)} · max|rX| ${model.maxFeatureCorrelation===null?'—':model.maxFeatureCorrelation.toFixed(2)} · max VIF ${model.maxVarianceInflationFactor===null?'—':model.maxVarianceInflationFactor.toFixed(1)} · λ ${model.ridgeLambda.toFixed(2)}`
              :`${i18n.t('evolution.multifactor.unavailable')} [${model.status}] · base ${model.baseSamples} · complete ${model.samples} · candidates ${model.candidateFeatures} · selected ${model.selectedFeatures}${model.maxFeatureCorrelation===null?'':` · max|rX| ${model.maxFeatureCorrelation.toFixed(2)}`}${model.maxVarianceInflationFactor===null?'':` · max VIF ${model.maxVarianceInflationFactor.toFixed(1)}`}`}
            ${model.coefficients.length?`<div class="evo-traits">${model.coefficients.map(feature=>`${i18n.t(`evolution.interaction.${feature.kind}`)} ← ${this.escape(this.wildlifeName(feature.sourceSpecies))} · β* ${feature.standardizedCoefficient===null?'—':feature.standardizedCoefficient.toFixed(2)} · cov ${feature.coverageSamples}/${model.baseSamples} · μ ${feature.mean.toFixed(1)} · σ ${feature.stdDev.toFixed(1)}`).join('<br>')}</div>`:''}
          </div>`).join('')}
        ${entry.multifactorSelection.stability.filter(stability=>stability.leaveOneGenerationOut.attemptedReplicates>=2||stability.localWindows.some(window=>window.model.estimable)).map(stability=>`
          <div class="evo-selection">
            <b>${i18n.t('evolution.stability')} · ${i18n.t(`evolution.outcome.${stability.outcome}`)}</b> · LOO-G ${stability.leaveOneGenerationOut.comparableReplicates}/${stability.leaveOneGenerationOut.estimableReplicates}/${stability.leaveOneGenerationOut.attemptedReplicates} tested · ${stability.leaveOneGenerationOut.availableGenerations} generations
            ${stability.leaveOneGenerationOut.coefficients.some(feature=>feature.comparableReplicates>0)?`<div class="evo-traits">${stability.leaveOneGenerationOut.coefficients.filter(feature=>feature.comparableReplicates>0).slice(0,4).map(feature=>`${i18n.t(`evolution.interaction.${feature.kind}`)} ← ${this.escape(this.wildlifeName(feature.sourceSpecies))} · sign ${feature.signConsistency===null?'—':feature.signConsistency.toFixed(2)} · β* [${feature.coefficientMin===null?'—':feature.coefficientMin.toFixed(2)}, ${feature.coefficientMax===null?'—':feature.coefficientMax.toFixed(2)}] · reps ${feature.comparableReplicates}`).join('<br>')}</div>`:''}
            ${stability.localWindows.length?`<div class="evo-traits"><b>${i18n.t('evolution.localWindow')}</b><br>${stability.localWindows.slice(-3).map(window=>`G${window.startGeneration}${window.startGeneration===window.endGeneration?'':`–G${window.endGeneration}`}${window.searchTruncated?'…':''} · n=${window.model.samples} · ${window.model.status}${window.model.estimable&&window.model.coefficients[0]?.standardizedCoefficient!==null?` · ${i18n.t(`evolution.interaction.${window.model.coefficients[0]!.kind}`)}←${this.escape(this.wildlifeName(window.model.coefficients[0]!.sourceSpecies))} β* ${window.model.coefficients[0]!.standardizedCoefficient!.toFixed(2)}`:''}`).join('<br>')}</div>`:''}
          </div>`).join('')}
      </div>`).join('');

    const selected=this.selectedEntity?.type==='wildlife'?this.wildlifeLineage.get(this.selectedEntity.id):undefined;
    const selectedStats=selected?stats.find(entry=>entry.species===selected.species):undefined;
    const ancestors=selected?lineageAncestors(this.wildlifeLineage,selected.entityId,3):[];
    const ancestry=selected?`
      <div class="evo-lineage">
        <b>${i18n.t('evolution.lineage')}</b> · ${this.escape(selected.entityId)} · G${selected.generation} · offspring ${selected.offspringCount}
        <div>${ancestors.length?ancestors.map(record=>`${this.escape(record.entityId)} (G${record.generation}${record.deathDay!==undefined?' †':''})`).join(' ← '):i18n.t('evolution.noAncestors')}</div>
        ${selected.habitatExposure?`<div>${i18n.t('evolution.exposure')} ${selected.habitatExposure.observedDays.toFixed(2)}d · ${i18n.t('evolution.dominantBiome')} ${this.escape(dominantWildlifeExposureBiome(selected.habitatExposure)||'—')} · ${i18n.t('evolution.transitions')} ${selected.habitatExposure.observedTransitions}</div>`:''}
        ${selected.habitatExposure?.predatorSourceMean&&selected.habitatExposure.predatorSourceObservedDays?`<div>${i18n.t('evolution.predatorSources')} ${Object.entries(selected.habitatExposure.predatorSourceMean).filter(([,value])=>Number(value)>0).sort((a,b)=>Number(b[1])-Number(a[1])).map(([species,value])=>`${this.escape(this.wildlifeName(species as WildlifeSpecies))} ${Number(value).toFixed(1)}`).join(' · ')||'—'} · obs ${selected.habitatExposure.predatorSourceObservedDays.toFixed(2)}d</div>`:''}
        ${selected.habitatExposure?.competitionSourceMean&&selected.habitatExposure.competitionSourceObservedDays?`<div>${i18n.t('evolution.competition')} ${i18n.t('evolution.sourceEvidence')} ${Object.entries(selected.habitatExposure.competitionSourceMean).filter(([,value])=>Number(value)>0).sort((a,b)=>Number(b[1])-Number(a[1])).slice(0,4).map(([species,value])=>`${this.escape(this.wildlifeName(species as WildlifeSpecies))} ${Number(value).toFixed(1)}`).join(' · ')||'—'} · obs ${selected.habitatExposure.competitionSourceObservedDays.toFixed(2)}d</div>`:''}
        ${selected.habitatExposure?.diseaseSourceMean&&selected.habitatExposure.diseaseSourceObservedDays?`<div>${i18n.t('evolution.diseasePressure')} ${i18n.t('evolution.sourceEvidence')} ${Object.entries(selected.habitatExposure.diseaseSourceMean).filter(([,value])=>Number(value)>0).sort((a,b)=>Number(b[1])-Number(a[1])).slice(0,4).map(([species,value])=>`${this.escape(this.wildlifeName(species as WildlifeSpecies))} ${Number(value).toFixed(1)}`).join(' · ')||'—'} · obs ${selected.habitatExposure.diseaseSourceObservedDays.toFixed(2)}d</div>`:''}
        ${selected.predationOutcomes?`<div>${i18n.t('evolution.realizedPredation')} · hunt ${selected.predationOutcomes.asPredator.huntHits}/${selected.predationOutcomes.asPredator.kills}/${selected.predationOutcomes.asPredator.huntAttempts} · escape ${selected.predationOutcomes.asPrey.successfulEscapes}/${selected.predationOutcomes.asPrey.fleeAttempts} · survive ${selected.predationOutcomes.asPrey.survivedAttacks}/${selected.predationOutcomes.asPrey.attacksReceived}</div>`:''}
        ${selected.migrationHistory?.length?`<div><b>${i18n.t('evolution.migrations')}</b><br>${selected.migrationHistory.slice(-4).map(event=>`Day ${event.day.toFixed(2)} · ${this.escape(event.fromChunkId)} → ${this.escape(event.toChunkId)} · ${event.representedPopulation.toFixed(2)}`).join('<br>')}</div>`:''}
        ${selectedStats?.cohorts.length?`<div class="evo-cohorts">${selectedStats.cohorts.slice(-6).map(cohort=>`G${cohort.generation}: n=${cohort.population}, μw=${trait(cohort.traitMean.wariness)}, var=${trait(cohort.traitVariance.wariness)}`).join('<br>')}</div>`:''}
      </div>`:'';

    const top=[...this.wildlifeLineage.values()].filter(record=>record.offspringCount>0)
      .sort((a,b)=>b.offspringCount-a.offspringCount||b.generation-a.generation).slice(0,4);
    const leaders=top.length?`<div class="evo-lineage"><b>${i18n.t('evolution.topLineages')}</b><div>${top.map(record=>`${this.escape(record.entityId)} · ${this.escape(this.wildlifeName(record.species))} · G${record.generation} · ${record.offspringCount}`).join('<br>')}</div></div>`:'';

    const networkCard=this.renderInteractionNetworkEvidence(interactionNetwork);
    const interactionSelectionCards=interactionSelection.slice(0,8).map(pair=>this.renderInteractionSelectionPairEvidence(pair)).join('');
    const coevolutionCards=coevolution.slice(0,6).map(pair=>this.renderCoevolutionPairEvidence(pair)).join('');
    ui.evolution.innerHTML=`<div class="evo-title">${i18n.t('evolution.title')} <span>${this.wildlifeLineage.size}</span></div>${networkCard}${cards||`<div class="small">${i18n.t('evolution.empty')}</div>`}${interactionSelectionCards}${coevolutionCards}${ancestry}${leaders}`;
  }

  worldSeason(){
    return (['spring','summer','autumn','winter'] as const)[Math.floor(Math.max(0,this.day-1)/30)%4]!;
  }

  gameTimeText(){const h=Math.floor(this.minuteOfDay/60)%24,m=Math.floor(this.minuteOfDay%60);return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;}
  say(a:NpcRuntime,text:string){a.speech={text,until:now()+Math.max(3500,Math.min(9000,text.length*220))};}
  event(text:string){this.recentEvents.push(`${this.gameTimeText()} ${text}`);if(this.recentEvents.length>30)this.recentEvents.shift();}
  log(text:string){this.logs.push(text);if(this.logs.length>80)this.logs.shift();}
  toast(text:string){ui.toast.textContent=text;ui.toast.classList.add('show');setTimeout(()=>ui.toast.classList.remove('show'),2200);}
  addInventory(inv:NpcState['inventory'],kind:ItemKind,count:number){const x=inv.find(i=>i.kind===kind);if(x)x.count+=count;else inv.push({kind,count});}
  itemName(k:ItemKind){return i18n.t(`item.${k}`);}
  parcelLabel(kind:ItemKind,count:number){return droppedParcelLabel(this.locale,this.itemName(kind),count);}
  escape(s:string){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]!));}

  playerOverlapsObjectTrigger(objectId:string) {
    return this.physics.overlappingTriggers(this.playerPosition,.30)
      .some(trigger=>trigger.id===`object-trigger:${objectId}`);
  }

  groundHeightAt(x:number,z:number) {
    return this.physics.groundContactAt(x,z)?.height??0;
  }

  alignNpcVisualToGround(agent:NpcRuntime) {
    const ground=this.groundHeightAt(agent.mesh.position.x,agent.mesh.position.z);
    agent.mesh.position.y=ground;
    agent.soles?.ground(ground);
  }

  wildlifePhysicsRadius(state:WildlifeState) {
    return clamp(.20+state.traits.size*.10,.24,.48);
  }

  physicsDynamicColliders(excludeId?:string):DynamicCollider[] {
    const colliders:DynamicCollider[]=[];
    if(this.cameraMode==='firstPerson'){
      colliders.push({id:'player',x:this.playerPosition.x,z:this.playerPosition.z,
        radius:PLAYER_BODY_RADIUS});
    }
    for(const agent of this.npcs.values()){
      if(agent.removed)continue;
      colliders.push({id:`npc:${agent.state.id}`,x:agent.mesh.position.x,z:agent.mesh.position.z,
        radius:NPC_BODY_RADIUS});
    }
    for(const animal of this.wildlife.values()){
      if(animal.removed)continue;
      colliders.push({
        id:`wildlife:${animal.state.id}`,
        x:animal.mesh.position.x,z:animal.mesh.position.z,
        radius:this.wildlifePhysicsRadius(animal.state)
      });
    }
    for(const object of this.objects.values()){
      if(!object.mesh.visible)continue;
      const archetype=worldObjectRigidBody(object.state);
      if(!archetype)continue;
      colliders.push({
        id:`object:${object.state.id}`,
        x:object.state.position.x,z:object.state.position.z,
        radius:archetype.radius
      });
    }
    return excludeId?colliders.filter(collider=>collider.id!==excludeId):colliders;
  }

  randomPassableNear(p:Vec2,radius:number,chunkId?:string):Vec2 {
    const chunk=chunkId?this.coarseWorld.chunks.get(chunkId):undefined;
    const half=this.coarseWorld.chunkSize/2-1;
    const minX=chunk?chunk.cx*this.coarseWorld.chunkSize-half:Number.NEGATIVE_INFINITY;
    const maxX=chunk?chunk.cx*this.coarseWorld.chunkSize+half:Number.POSITIVE_INFINITY;
    const minZ=chunk?chunk.cz*this.coarseWorld.chunkSize-half:Number.NEGATIVE_INFINITY;
    const maxZ=chunk?chunk.cz*this.coarseWorld.chunkSize+half:Number.POSITIVE_INFINITY;
    for(let i=0;i<60;i++){
      const x=Math.round(clamp(p.x+(Math.random()*2-1)*radius,minX,maxX));
      const z=Math.round(clamp(p.z+(Math.random()*2-1)*radius,minZ,maxZ));
      if(!this.physics.isBlocked(x,z,.28))return{x,z};
    }
    return{x:p.x,z:p.z};
  }

  findPath(start:Vec2,end:Vec2):Vec2[] {
    const s={x:Math.round(start.x),z:Math.round(start.z)},g={x:Math.round(end.x),z:Math.round(end.z)};
    const margin=Math.max(24,Math.abs(g.x-s.x)+Math.abs(g.z-s.z)+12);
    const minX=Math.min(s.x,g.x)-margin,maxX=Math.max(s.x,g.x)+margin,minZ=Math.min(s.z,g.z)-margin,maxZ=Math.max(s.z,g.z)+margin;
    const passable=(x:number,z:number)=>x>=minX&&x<=maxX&&z>=minZ&&z<=maxZ&&(!this.physics.isBlocked(x,z,.24)||(x===g.x&&z===g.z));
    const open=[s],came=new Map<string,string>(),cost=new Map<string,number>([[keyOf(s.x,s.z),0]]);const goalKey=keyOf(g.x,g.z);let found=false;
    while(open.length&&cost.size<9000){open.sort((a,b)=>(cost.get(keyOf(a.x,a.z))!+Math.abs(a.x-g.x)+Math.abs(a.z-g.z))-(cost.get(keyOf(b.x,b.z))!+Math.abs(b.x-g.x)+Math.abs(b.z-g.z)));const cur=open.shift()!;const ck=keyOf(cur.x,cur.z);if(ck===goalKey){found=true;break;}for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=cur.x+dx,nz=cur.z+dz,nk=keyOf(nx,nz);if(!passable(nx,nz))continue;const nc=cost.get(ck)!+1;if(nc<(cost.get(nk)??Infinity)){cost.set(nk,nc);came.set(nk,ck);open.push({x:nx,z:nz});}}}
    if(!found)return[];const rev:Vec2[]=[];let k=goalKey;while(k!==keyOf(s.x,s.z)){const [x,z]=k.split(',').map(Number);rev.push({x,z});const prev=came.get(k);if(!prev)break;k=prev;}return rev.reverse();
  }
}

new TownGame();
