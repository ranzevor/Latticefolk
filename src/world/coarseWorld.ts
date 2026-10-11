import {DEFAULT_WORLD_SEED,hashText} from './worldRandom.js';
import * as THREE from 'three';
import type {
  ChunkBiome, ChunkDecisionRequest, ChunkDecisionResponse, ChunkStrategy,
  ChunkMigrationPolicy, ChunkEcologyPolicy, CoarseChunkState,
  RegionState, RegionDecision, RegionDecisionRequest, RegionDecisionResponse,
  WildlifeCompetitionPair, WildlifeDiseasePair, WildlifePredatorPressurePair, WorldDecision, WorldDecisionRequest, WorldDecisionResponse, WorldStrategicSummary
} from '../types';
import { applyConservedFlows, planConservedFlows, type WorldFlowRecord } from './flows';
import { applyWildlifeMigration, ensureWildlifePopulations, planWildlifeMigration, simulateWildlife } from './ecology';
import { boundedDecisionIdWindow, captureChunkDecisionSignal, nextChunkDecisionDelay, rankChunkDecisionCandidates, type ChunkDecisionSignal } from './decisionScheduling';
import { CoarseChunkSpatialIndex } from './coarseSpatialIndex';
import { coarseMarkerVisualSpec, type CoarseMarkerVisualSpec } from '../scene/coarsePresentation';
import { fineTerrainSurfaceForChunk } from './fineTerrain';
import {streamedUnitForCoarseCell,streamedUnitOwnerCells} from './streamedUnits.js';

const clamp=(v:number,min=0,max=100)=>Math.max(min,Math.min(max,v));

const CHUNK_STRATEGIES=new Set<ChunkStrategy>(['sustain','grow_settlement','conserve','extract_resources','fortify','trade_route']);
const CHUNK_MIGRATION_POLICIES=new Set<ChunkMigrationPolicy>(['attract','retain','release','evacuate']);
const CHUNK_ECOLOGY_POLICIES=new Set<ChunkEcologyPolicy>(['recover','balance','harvest','protect']);
const REGION_PRIORITIES=new Set(['balanced','food_security','trade_network','settlement_growth','ecology_recovery','security_coordination']);
const REGION_MOVEMENT_POLICIES=new Set(['open','stabilize','redistribute','restrict']);
const REGION_ECOLOGY_POLICIES=new Set(['restore_corridors','balanced_use','protected_network','productive_landscape']);
const WORLD_PRIORITIES=new Set(['resilience','prosperity','expansion','ecology','security','exploration']);
const WORLD_CONNECTIVITY_POLICIES=new Set(['localism','balanced_networks','trade_corridors','migration_corridors']);
const WORLD_GROWTH_POLICIES=new Set(['steady','compact','frontier','conserve']);

const isRecord=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const isUnitConfidence=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1;
const isNonemptyString=(value:unknown)=>typeof value==='string'&&value.length>0;

function isChunkDecision(value:unknown):value is ChunkDecisionResponse['decisions'][number] {
  if(!isRecord(value))return false;
  return isNonemptyString(value.chunkId)
    &&CHUNK_STRATEGIES.has(value.strategy as ChunkStrategy)
    &&CHUNK_MIGRATION_POLICIES.has(value.migrationPolicy as ChunkMigrationPolicy)
    &&CHUNK_ECOLOGY_POLICIES.has(value.ecologyPolicy as ChunkEcologyPolicy)
    &&isUnitConfidence(value.confidence)
    &&isNonemptyString(value.reasonCode)
    &&isNonemptyString(value.source);
}
function isChunkDecisionResponse(value:unknown):value is ChunkDecisionResponse {
  return isRecord(value)&&isNonemptyString(value.source)&&Array.isArray(value.decisions);
}
function isRegionDecision(value:unknown):value is RegionDecision {
  if(!isRecord(value))return false;
  return isNonemptyString(value.regionId)
    &&REGION_PRIORITIES.has(value.priority as string)
    &&REGION_MOVEMENT_POLICIES.has(value.movementPolicy as string)
    &&REGION_ECOLOGY_POLICIES.has(value.ecologyPolicy as string)
    &&isUnitConfidence(value.confidence)
    &&isNonemptyString(value.reasonCode)
    &&isNonemptyString(value.source);
}
function isRegionDecisionResponse(value:unknown):value is RegionDecisionResponse {
  return isRecord(value)&&isNonemptyString(value.source)&&Array.isArray(value.decisions);
}
function isWorldDecision(value:unknown):value is WorldDecision {
  if(!isRecord(value))return false;
  return WORLD_PRIORITIES.has(value.priority as string)
    &&WORLD_CONNECTIVITY_POLICIES.has(value.connectivity as string)
    &&WORLD_GROWTH_POLICIES.has(value.growth as string)
    &&isUnitConfidence(value.confidence)
    &&isNonemptyString(value.reasonCode)
    &&isNonemptyString(value.source);
}
function isWorldDecisionResponse(value:unknown):value is WorldDecisionResponse {
  return isRecord(value)&&isNonemptyString(value.source)&&isWorldDecision(value.decision);
}

export interface CoarseWorldStatus {
  chunks: number;
  decidedChunks: number;
  pending: boolean;
  lastSource: string;
  lastBatchSize: number;
  materializedChunks: number;
  activeChunks: number;
  activeCenter: string;
  recentFlowCount: number;
  lastFlowSummary: string;
  regionDecisions: number;
  worldPriority: string;
  worldConnectivity: string;
  worldGrowth: string;
  wildlifePopulation: number;
  plantBiomass: number;
  trophicPrimary: number;
  trophicHerbivory: number;
  trophicPredation: number;
  nicheCompetition: number;
  strongestCompetition: string;
  wildlifeDiseasePressure: number;
  strongestDiseaseTransmission: string;
  wildlifePredatorPressure: number;
  strongestPredatorPressure: string;
  avgPopulation: number;
  avgEcology: number;
  avgProsperity: number;
  requestTimeouts: number;
}

interface UpdateContext {
  day: number;
  gameTime: string;
  weather: string;
  dt: number;
}

export interface CoarsePresentationBridge {
  attach(group:THREE.Group,spec:CoarseMarkerVisualSpec):void;
  detach(group:THREE.Group):void;
}

export interface CoarseMarkerPresentationStatus {
  chunkId:string;
  asset:string;
  kind:string;
  visible:boolean;
  resolved:boolean;
  meshes:number;
  primitiveMeshes:number;
}

export class CoarseWorldRuntime {
  readonly chunkSize = 24;
  readonly radius = 4;
  readonly localRadius = 1;
  readonly chunks = new Map<string,CoarseChunkState>();
  readonly chunkSpatialIndex = new CoarseChunkSpatialIndex();
  readonly materialized = new Set<string>();
  readonly activeChunkIds = new Set<string>();

  private root = new THREE.Group();
  private tiles = new Map<string,THREE.Mesh>();
  private markers = new Map<string,THREE.Group>();
  private pending=false;
  private lastSource='seeded';
  private lastBatchSize=0;
  private nextDecisionAt=performance.now()+3500;
  private simulationAccumulator=0;
  private flowAccumulator=0;
  private recentFlowLog:WorldFlowRecord[]=[];
  private regionPolicies = new Map<string,RegionDecision>();
  private worldPolicy:WorldDecision={
    priority:'resilience',connectivity:'balanced_networks',growth:'steady',
    confidence:.4,reasonCode:'world_initial',source:'seeded'
  };
  private nextRegionDecisionAt=performance.now()+9000;
  private nextWorldDecisionAt=performance.now()+18000;
  private regionPending=false;
  private worldPending=false;
  private activeCenterCx=Number.NaN;
  private activeCenterCz=Number.NaN;
  private decisionBaselines=new Map<string,ChunkDecisionSignal>();
  private decisionScanIds:string[]=[];
  private decisionScanCursor=0;
  private readonly maxDecisionScanPerWake=256;
  private requestTimeouts=0;
  private decisionContextGeneration=0;
  private decisionContextController=new AbortController();
  private presentationBridge?:CoarsePresentationBridge;

  constructor(
    private scene:THREE.Scene,
    private worldSeed=DEFAULT_WORLD_SEED,
    private readonly requestDeadlineMs=8_000
  ) {
    this.root.name='coarse-world';
    this.scene.add(this.root);
    this.generate();
  }

  get seed(){return this.worldSeed;}

  private hash(cx:number,cz:number,salt=0) {
    const s=`${this.worldSeed}:${cx}:${cz}:${salt}`;
    return hashText(s)/4294967295;
  }

  private biomeFor(cx:number,cz:number):ChunkBiome {
    const r=this.hash(cx,cz,1);
    if(r<.18)return 'forest';
    if(r<.34)return 'hills';
    if(r<.46)return 'wetlands';
    if(r<.58)return 'dryland';
    return 'plains';
  }

  private generate() {
    this.ensureWindowAround(0,0,true);
  }

  setPresentationBridge(bridge:CoarsePresentationBridge|undefined) {
    if(this.presentationBridge&&this.presentationBridge!==bridge){
      for(const marker of this.markers.values())this.presentationBridge.detach(marker);
    }
    this.presentationBridge=bridge;
    for(const id of this.activeChunkIds){
      const chunk=this.chunks.get(id);
      if(chunk)this.refreshMarker(chunk);
    }
  }

  private isHomeChunk(cx:number,cz:number) {
    return Math.abs(cx)<=this.localRadius&&Math.abs(cz)<=this.localRadius;
  }

  private createChunkState(cx:number,cz:number):CoarseChunkState {
    const biome=this.biomeFor(cx,cz);
    const settlementRoll=this.hash(cx,cz,2);
    const settlementLevel=settlementRoll>.86?2:settlementRoll>.62?1:0;
    const population=settlementLevel===0?Math.floor(this.hash(cx,cz,3)*4):Math.floor(5+this.hash(cx,cz,3)*(settlementLevel===2?26:12));
    const bias=(biome==='wetlands'||biome==='plains')?12:biome==='dryland'?-14:0;
    const chunk:CoarseChunkState={
      id:`chunk_${cx}_${cz}`,cx,cz,biome,settlementLevel,population,
      food:clamp(42+bias+this.hash(cx,cz,4)*42),
      wood:clamp(35+(biome==='forest'?35:0)+this.hash(cx,cz,5)*34),
      water:clamp(42+(biome==='wetlands'?35:biome==='dryland'?-25:0)+this.hash(cx,cz,6)*38),
      ecology:clamp(48+this.hash(cx,cz,7)*42-settlementLevel*7),
      danger:clamp(10+this.hash(cx,cz,8)*46),
      prosperity:clamp(18+settlementLevel*20+this.hash(cx,cz,9)*30),
      strategy:'sustain',migrationPolicy:'retain',ecologyPolicy:'balance',
      lastDecisionAt:0,decisionVersion:0
    };
    ensureWildlifePopulations(chunk);
    return chunk;
  }

  ensureChunk(cx:number,cz:number) {
    if(this.isHomeChunk(cx,cz))return undefined;
    const id=`chunk_${cx}_${cz}`;
    let chunk=this.chunks.get(id);
    if(!chunk){
      chunk=this.createChunkState(cx,cz);
      this.chunks.set(id,chunk);
      this.chunkSpatialIndex.upsert(chunk);
      this.decisionScanIds.push(id);
    }
    return chunk;
  }

  ensureWindowAround(x:number,z:number,force=false) {
    const cx=Math.floor((x+this.chunkSize/2)/this.chunkSize);
    const cz=Math.floor((z+this.chunkSize/2)/this.chunkSize);
    if(!force&&cx===this.activeCenterCx&&cz===this.activeCenterCz)return false;
    this.activeCenterCx=cx;this.activeCenterCz=cz;

    const desired=new Set<string>(),units=new Map<string,{ux:number;uz:number}>();
    for(let dz=-this.radius;dz<=this.radius;dz++) for(let dx=-this.radius;dx<=this.radius;dx++){
      const tx=cx+dx,tz=cz+dz;
      if(this.isHomeChunk(tx,tz))continue;
      const unit=streamedUnitForCoarseCell(tx,tz);units.set(unit.id,unit);
    }
    for(const unit of units.values())for(const owner of streamedUnitOwnerCells(unit.ux,unit.uz)){
      const chunk=this.ensureChunk(owner.cx,owner.cz);
      if(!chunk)continue;
      desired.add(chunk.id);
      if(!this.tiles.has(chunk.id))this.createTile(chunk);
    }

    for(const id of [...this.activeChunkIds]){
      if(desired.has(id)||this.materialized.has(id))continue;
      this.removeVisualChunk(id);
    }
    this.activeChunkIds.clear();
    for(const id of desired)this.activeChunkIds.add(id);
    return true;
  }

  restoreKnownChunks(saved:CoarseChunkState[]) {
    let restoredAny=false;
    for(const state of saved){
      if(!state||typeof state.id!=='string')continue;
      const restored=structuredClone(state);ensureWildlifePopulations(restored);
      if(!this.chunks.has(state.id))this.decisionScanIds.push(state.id);
      this.chunks.set(state.id,restored);
      this.chunkSpatialIndex.upsert(restored);
      this.decisionBaselines.delete(state.id);
      restoredAny=true;
    }
    if(restoredAny)this.invalidateDecisionContext();
    for(const id of this.activeChunkIds){
      const chunk=this.chunks.get(id);
      if(!chunk)continue;
      if(!this.tiles.has(id))this.createTile(chunk);
      else this.refreshMarker(chunk);
    }
  }

  activeBounds() {
    const active=[...this.activeChunkIds].map(id=>this.chunks.get(id)).filter((c):c is CoarseChunkState=>Boolean(c));
    if(active.length)return {minX:Math.min(...active.map(c=>(c.cx-.5)*this.chunkSize)),maxX:Math.max(...active.map(c=>(c.cx+.5)*this.chunkSize)),
      minZ:Math.min(...active.map(c=>(c.cz-.5)*this.chunkSize)),maxZ:Math.max(...active.map(c=>(c.cz+.5)*this.chunkSize))};
    const span=(this.radius+.5)*this.chunkSize;
    const centerX=(Number.isFinite(this.activeCenterCx)?this.activeCenterCx:0)*this.chunkSize;
    const centerZ=(Number.isFinite(this.activeCenterCz)?this.activeCenterCz:0)*this.chunkSize;
    return {minX:centerX-span,maxX:centerX+span,minZ:centerZ-span,maxZ:centerZ+span};
  }

  private colorForBiome(biome:ChunkBiome) {
    return ({
      plains:0x7ea965, forest:0x47794e, hills:0x87906c, wetlands:0x5f8b79, dryland:0xa48c61
    } as Record<ChunkBiome,number>)[biome];
  }

  private createTile(chunk:CoarseChunkState) {
    if(this.tiles.has(chunk.id))return;
    const material=new THREE.MeshStandardMaterial({
      color:this.colorForBiome(chunk.biome),roughness:1,metalness:0
    });
    // Ground presentation uses the same full footprint and elevation as fine physics.
    const surface=fineTerrainSurfaceForChunk(chunk,this.chunkSize);
    const thickness=.18;
    const tile=new THREE.Mesh(new THREE.BoxGeometry(surface.maxX-surface.minX,thickness,surface.maxZ-surface.minZ),material);
    tile.position.set(surface.originX,surface.originY-thickness/2,surface.originZ);
    tile.receiveShadow=true;
    tile.userData={coarseChunkId:chunk.id};
    this.root.add(tile);
    this.tiles.set(chunk.id,tile);

    const marker=new THREE.Group();
    marker.position.set(chunk.cx*this.chunkSize,0,chunk.cz*this.chunkSize);
    marker.userData={coarseChunkId:chunk.id};
    this.root.add(marker);
    this.markers.set(chunk.id,marker);
    this.refreshMarker(chunk);
  }

  private removeVisualChunk(chunkId:string) {
    const tile=this.tiles.get(chunkId);
    if(tile){
      this.root.remove(tile);
      tile.geometry.dispose();
      const material=tile.material;
      if(Array.isArray(material))material.forEach(x=>x.dispose());else material.dispose();
      this.tiles.delete(chunkId);
    }
    const marker=this.markers.get(chunkId);
    if(marker){
      this.presentationBridge?.detach(marker);
      marker.clear();
      this.root.remove(marker);
      this.markers.delete(chunkId);
    }
    this.activeChunkIds.delete(chunkId);
  }

  private refreshMarker(chunk:CoarseChunkState) {
    const marker=this.markers.get(chunk.id);if(!marker)return;
    this.presentationBridge?.detach(marker);
    marker.clear();
    const spec=coarseMarkerVisualSpec(chunk);
    marker.userData.coarseMarkerAsset=spec.asset;
    marker.userData.coarseMarkerKind=spec.kind;
    if(this.presentationBridge)this.presentationBridge.attach(marker,spec);
  }

  presentationStatus():CoarseMarkerPresentationStatus[] {
    return [...this.markers.entries()].map(([chunkId,marker])=>{
      let meshes=0,primitiveMeshes=0;
      marker.traverse(object=>{
        const mesh=object as THREE.Mesh;
        if(!mesh.isMesh)return;
        meshes++;
        if(['BoxGeometry','CylinderGeometry','ConeGeometry','PlaneGeometry','SphereGeometry'].includes(mesh.geometry?.type||''))primitiveMeshes++;
      });
      return {
        chunkId,
        asset:String(marker.userData.coarseMarkerAsset||''),
        kind:String(marker.userData.coarseMarkerKind||''),
        visible:marker.visible,
        resolved:marker.children.length>0,
        meshes,primitiveMeshes
      };
    });
  }

  update(ctx:UpdateContext) {
    let decisionStateChanged=false;
    this.simulationAccumulator+=ctx.dt;
    if(this.simulationAccumulator>=1){
      const steps=Math.floor(this.simulationAccumulator);
      this.simulationAccumulator-=steps;
      for(const chunk of this.chunks.values())if(!this.materialized.has(chunk.id))this.simulate(chunk,steps,ctx.weather,ctx.day);
      decisionStateChanged=true;
    }
    this.flowAccumulator+=ctx.dt;
    if(this.flowAccumulator>=5){
      this.flowAccumulator%=5;
      this.runConservedFlows(ctx);
      decisionStateChanged=true;
    }
    if(decisionStateChanged)this.wakeChunkDecisionDeadline();
    const tick=performance.now();
    if(!this.pending&&tick>=this.nextDecisionAt)void this.requestBatch(ctx);
    if(!this.regionPending&&tick>=this.nextRegionDecisionAt)void this.requestRegions(ctx);
    if(!this.worldPending&&tick>=this.nextWorldDecisionAt)void this.requestWorld(ctx);
  }

  private simulate(chunk:CoarseChunkState,seconds:number,weather:string,day:number) {
    const scale=seconds*.035;
    const biomeFood=chunk.biome==='plains'?1.2:chunk.biome==='wetlands'?1.05:chunk.biome==='dryland' ? .55 : .82;
    const rain=weather==='rain'?1.18:weather==='clear' ? .98 : 1.04;
    chunk.food=clamp(chunk.food+(biomeFood*rain-.7-chunk.population*.006)*scale);
    chunk.water=clamp(chunk.water+((weather==='rain'?1.5:chunk.biome==='wetlands' ? .75 : -.28)-chunk.population*.003)*scale);
    chunk.wood=clamp(chunk.wood+((chunk.biome==='forest'?1.15:.45)-chunk.population*.004)*scale);
    chunk.ecology=clamp(chunk.ecology+(.18-chunk.population*.002)*scale);

    const region=this.regionPolicies.get(this.regionId(chunk.cx,chunk.cz));
    const world=this.worldPolicy;
    if(region?.priority==='food_security')chunk.food=clamp(chunk.food+.12*scale);
    if(region?.priority==='ecology_recovery')chunk.ecology=clamp(chunk.ecology+.12*scale);
    if(region?.priority==='security_coordination')chunk.danger=clamp(chunk.danger-.10*scale);
    if(world.priority==='ecology')chunk.ecology=clamp(chunk.ecology+.07*scale);
    if(world.priority==='security')chunk.danger=clamp(chunk.danger-.06*scale);

    const strategyEffect:Record<ChunkStrategy,()=>void>={
      sustain:()=>{chunk.prosperity=clamp(chunk.prosperity+.05*scale);},
      grow_settlement:()=>{chunk.food=clamp(chunk.food-.7*scale);chunk.wood=clamp(chunk.wood-.55*scale);chunk.prosperity=clamp(chunk.prosperity+.9*scale);},
      conserve:()=>{chunk.food=clamp(chunk.food+.4*scale);chunk.ecology=clamp(chunk.ecology+.7*scale);chunk.prosperity=clamp(chunk.prosperity-.18*scale);},
      extract_resources:()=>{chunk.wood=clamp(chunk.wood+1.15*scale);chunk.ecology=clamp(chunk.ecology-.72*scale);chunk.prosperity=clamp(chunk.prosperity+.65*scale);},
      fortify:()=>{chunk.danger=clamp(chunk.danger-.8*scale);chunk.prosperity=clamp(chunk.prosperity-.25*scale);},
      trade_route:()=>{chunk.prosperity=clamp(chunk.prosperity+1.0*scale);chunk.food=clamp(chunk.food+.22*scale);}
    };
    strategyEffect[chunk.strategy]();
    simulateWildlife(chunk,seconds,weather,day);

    if(chunk.ecologyPolicy==='recover')chunk.ecology=clamp(chunk.ecology+.9*scale);
    if(chunk.ecologyPolicy==='protect')chunk.ecology=clamp(chunk.ecology+.55*scale);
    if(chunk.ecologyPolicy==='harvest'){chunk.ecology=clamp(chunk.ecology-.5*scale);chunk.food=clamp(chunk.food+.45*scale);}

    // Migration policies influence paired flows only; they never mint or delete residents.
    // Demographic births/deaths require their own deterministic rules and provenance.

    const growthThreshold=world.growth==='frontier' ? .60 : world.growth==='compact' ? .78 : world.growth==='conserve' ? .9 : .7;
    if(chunk.strategy==='grow_settlement'&&chunk.population>12&&chunk.prosperity>58&&chunk.settlementLevel<3&&this.hash(chunk.cx,chunk.cz,chunk.decisionVersion+100)>growthThreshold){
      chunk.settlementLevel++;
      this.refreshMarker(chunk);
    }
  }

  private runConservedFlows(ctx:UpdateContext) {
    const planned=planConservedFlows(this.chunks.values(),{
      day:ctx.day,
      minuteOfDay:this.parseGameTime(ctx.gameTime),
      materialized:this.materialized
    },this.chunkSpatialIndex);
    const adjusted=planned.map(flow=>{
      const source=this.chunks.get(flow.fromChunkId);
      const target=this.chunks.get(flow.toChunkId);
      const sourceRegion=source?this.regionPolicies.get(this.regionId(source.cx,source.cz)):undefined;
      const targetRegion=target?this.regionPolicies.get(this.regionId(target.cx,target.cz)):undefined;
      let factor=1;
      if(flow.kind.endsWith('_trade')&&this.worldPolicy.connectivity==='trade_corridors')factor*=1.18;
      if(flow.kind==='migration'&&this.worldPolicy.connectivity==='migration_corridors')factor*=1.18;
      if(flow.kind==='ecology_spread'&&this.worldPolicy.priority==='ecology')factor*=1.2;
      if(sourceRegion?.priority==='trade_network'&&flow.kind.endsWith('_trade'))factor*=1.12;
      if(targetRegion?.priority==='food_security'&&flow.kind==='food_trade')factor*=1.12;
      if(targetRegion?.priority==='ecology_recovery'&&flow.kind==='ecology_spread')factor*=1.15;
      if(sourceRegion?.movementPolicy==='restrict'&&flow.kind==='migration')factor*=.55;
      if(targetRegion?.movementPolicy==='open'&&flow.kind==='migration')factor*=1.08;
      return {...flow,amount:flow.amount*factor};
    });
    const applied=applyConservedFlows(this.chunks,adjusted);
    const wildlifeMoves=planWildlifeMigration(this.chunks.values(),this.materialized,ctx.day,this.chunkSpatialIndex);
    applyWildlifeMigration(this.chunks,wildlifeMoves);
    if(applied.length){
      this.recentFlowLog.push(...applied);
      if(this.recentFlowLog.length>120)this.recentFlowLog.splice(0,this.recentFlowLog.length-120);
    }
  }

  private parseGameTime(value:string) {
    const [h,m]=value.split(':').map(Number);
    return (Number.isFinite(h)?h:0)*60+(Number.isFinite(m)?m:0);
  }

  flowHistory(limit=20) {
    return this.recentFlowLog.slice(-Math.max(0,limit));
  }

  private regionId(cx:number,cz:number) {
    const rx=Math.floor(cx/3);
    const rz=Math.floor(cz/3);
    return `region_${rx}_${rz}`;
  }

  private aggregateRegions():RegionState[] {
    const groups=new Map<string,CoarseChunkState[]>();
    for(const chunk of this.chunks.values()){
      const id=this.regionId(chunk.cx,chunk.cz);
      const list=groups.get(id)||[];
      list.push(chunk);groups.set(id,list);
    }
    const avg=(list:CoarseChunkState[],pick:(c:CoarseChunkState)=>number)=>list.reduce((s,c)=>s+pick(c),0)/Math.max(1,list.length);
    return [...groups.entries()].map(([id,list])=>{
      const [rx,rz]=id.replace('region_','').split('_').map(Number);
      return {
        id,rx,rz,chunkIds:list.map(c=>c.id),
        population:list.reduce((s,c)=>s+c.population,0),
        settlements:list.reduce((s,c)=>s+(c.settlementLevel>0?1:0),0),
        food:avg(list,c=>c.food),wood:avg(list,c=>c.wood),water:avg(list,c=>c.water),
        ecology:avg(list,c=>c.ecology),danger:avg(list,c=>c.danger),prosperity:avg(list,c=>c.prosperity)
      };
    });
  }

  private worldSummary(regions:RegionState[]):WorldStrategicSummary {
    const chunks=[...this.chunks.values()];
    const avg=(pick:(c:CoarseChunkState)=>number)=>chunks.reduce((s,c)=>s+pick(c),0)/Math.max(1,chunks.length);
    return {
      population:chunks.reduce((s,c)=>s+c.population,0),
      settlements:chunks.reduce((s,c)=>s+(c.settlementLevel>0?1:0),0),
      food:avg(c=>c.food),wood:avg(c=>c.wood),water:avg(c=>c.water),ecology:avg(c=>c.ecology),
      danger:avg(c=>c.danger),prosperity:avg(c=>c.prosperity),activeRegions:regions.length
    };
  }

  private invalidateDecisionContext() {
    this.decisionContextGeneration++;
    const previous=this.decisionContextController;
    this.decisionContextController=new AbortController();
    previous.abort();
  }

  private async postDecision(url:string,body:unknown):Promise<unknown> {
    const controller=new AbortController();
    const contextSignal=this.decisionContextController.signal;
    let timeout:ReturnType<typeof setTimeout>|undefined;
    let settled=false;
    const deadline=new Promise<never>((_,reject)=>{
      timeout=setTimeout(()=>{
        if(settled)return;
        settled=true;
        this.requestTimeouts++;
        controller.abort();
        reject(new Error(`decision request timed out: ${url}`));
      },this.requestDeadlineMs);
    });
    let cancel=()=>{};
    const cancelled=new Promise<never>((_,reject)=>{
      cancel=()=>{
        if(settled)return;
        settled=true;
        if(timeout!==undefined)clearTimeout(timeout);
        controller.abort();
        reject(new Error(`decision context invalidated: ${url}`));
      };
      contextSignal.addEventListener('abort',cancel,{once:true});
    });
    const request=(async()=>{
      const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
      if(controller.signal.aborted)throw new Error(`decision request aborted: ${url}`);
      if(!response.ok)throw new Error(`decision request failed: ${url}`);
      return await response.json() as unknown;
    })();
    try{return await Promise.race([request,deadline,cancelled]);}
    finally{
      settled=true;
      if(timeout!==undefined)clearTimeout(timeout);
      contextSignal.removeEventListener('abort',cancel);
    }
  }

  private async requestRegions(ctx:UpdateContext) {
    this.regionPending=true;
    const requestGeneration=this.decisionContextGeneration;
    const regions=this.aggregateRegions().sort((a,b)=>{
      const score=(r:RegionState)=>(this.regionPolicies.has(r.id)?0:1000)+(100-r.food)+(100-r.water)+r.danger+(100-r.ecology)*.5;
      return score(b)-score(a);
    }).slice(0,8);
    const requestedRegionIds=new Set(regions.map(region=>region.id));
    const body:RegionDecisionRequest={day:ctx.day,gameTime:ctx.gameTime,weather:ctx.weather,regions};
    try{
      const raw=await this.postDecision('/api/world/regions/decide',body);
      if(requestGeneration!==this.decisionContextGeneration||!isRegionDecisionResponse(raw))return;
      const counts=new Map<string,number>();
      for(const row of raw.decisions)if(isRecord(row)&&typeof row.regionId==='string')counts.set(row.regionId,(counts.get(row.regionId)||0)+1);
      for(const decision of raw.decisions){
        if(!isRegionDecision(decision)||counts.get(decision.regionId)!==1||!requestedRegionIds.has(decision.regionId))continue;
        this.regionPolicies.set(decision.regionId,decision);
      }
    }catch{
      // Existing regional policies remain authoritative until the next successful refresh.
    }finally{
      this.regionPending=false;
      this.nextRegionDecisionAt=performance.now()+45_000;
    }
  }

  private async requestWorld(ctx:UpdateContext) {
    this.worldPending=true;
    const requestGeneration=this.decisionContextGeneration;
    const regions=this.aggregateRegions();
    const regionDecisions=regions.map(region=>this.regionPolicies.get(region.id)).filter((x):x is RegionDecision=>Boolean(x)).slice(0,16);
    const body:WorldDecisionRequest={day:ctx.day,gameTime:ctx.gameTime,weather:ctx.weather,summary:this.worldSummary(regions),regions:regionDecisions};
    try{
      const raw=await this.postDecision('/api/world/strategy/decide',body);
      if(requestGeneration!==this.decisionContextGeneration||!isWorldDecisionResponse(raw))return;
      this.worldPolicy=raw.decision;
    }catch{
      // Keep the previous bounded world policy if the provider is temporarily unavailable.
    }finally{
      this.worldPending=false;
      this.nextWorldDecisionAt=performance.now()+120_000;
    }
  }

  private scheduledChunkDecisions(limit=8) {
    const window=boundedDecisionIdWindow(this.decisionScanIds,this.decisionScanCursor,this.maxDecisionScanPerWake);
    const chunks:CoarseChunkState[]=[];
    for(const id of window.ids){const chunk=this.chunks.get(id);if(chunk)chunks.push(chunk);}
    return {candidates:rankChunkDecisionCandidates(chunks,this.decisionBaselines,Date.now(),this.materialized,limit),nextCursor:window.nextCursor};
  }

  private wakeChunkDecisionDeadline() {
    if(this.pending)return;
    const delay=nextChunkDecisionDelay(this.scheduledChunkDecisions(1).candidates);
    const wakeAt=performance.now()+delay;
    if(wakeAt<this.nextDecisionAt)this.nextDecisionAt=wakeAt;
  }

  private async requestBatch(ctx:UpdateContext) {
    this.pending=true;
    const requestGeneration=this.decisionContextGeneration;
    const scheduled=this.scheduledChunkDecisions(8);
    this.decisionScanCursor=scheduled.nextCursor;
    const chunks=scheduled.candidates.map(candidate=>candidate.chunk);
    if(!chunks.length){this.pending=false;this.nextDecisionAt=performance.now()+30_000;return;}
    const capturedAt=Date.now();
    const membership=new Map(chunks.map(chunk=>[chunk.id,{chunk,signal:captureChunkDecisionSignal(chunk,capturedAt)}]));
    let completed=false;
    const body:ChunkDecisionRequest={day:ctx.day,gameTime:ctx.gameTime,weather:ctx.weather,chunks};
    try{
      const raw=await this.postDecision('/api/world/chunks/decide',body);
      if(requestGeneration!==this.decisionContextGeneration||!isChunkDecisionResponse(raw))return;
      const counts=new Map<string,number>();
      for(const row of raw.decisions)if(isRecord(row)&&typeof row.chunkId==='string')counts.set(row.chunkId,(counts.get(row.chunkId)||0)+1);
      const decidedAt=Date.now();
      let accepted=0;
      for(const decision of raw.decisions){
        if(!isChunkDecision(decision)||counts.get(decision.chunkId)!==1)continue;
        const member=membership.get(decision.chunkId);if(!member)continue;
        const chunk=this.chunks.get(decision.chunkId);
        if(chunk!==member.chunk||this.materialized.has(decision.chunkId))continue;
        chunk.strategy=decision.strategy;
        chunk.migrationPolicy=decision.migrationPolicy;
        chunk.ecologyPolicy=decision.ecologyPolicy;
        chunk.lastDecisionAt=decidedAt;
        chunk.decisionVersion++;
        this.decisionBaselines.set(chunk.id,member.signal);
        accepted++;
      }
      if(accepted>0){this.lastSource=raw.source;this.lastBatchSize=accepted;completed=true;}
      else{this.lastSource='offline';this.lastBatchSize=0;}
    }catch{
      if(requestGeneration===this.decisionContextGeneration){
        this.lastSource='offline';
        this.lastBatchSize=0;
      }
    }finally{
      this.pending=false;
      const delay=completed?nextChunkDecisionDelay(this.scheduledChunkDecisions(1).candidates):15_000;
      this.nextDecisionAt=performance.now()+delay;
    }
  }

  chunkAtWorld(x:number,z:number) {
    const cx=Math.floor((x+this.chunkSize/2)/this.chunkSize);
    const cz=Math.floor((z+this.chunkSize/2)/this.chunkSize);
    if(this.isHomeChunk(cx,cz))return undefined;
    return this.chunks.get(`chunk_${cx}_${cz}`);
  }

  setMaterialized(chunkId:string,value:boolean) {
    const chunk=this.chunks.get(chunkId);
    if(!chunk)return;
    const wasMaterialized=this.materialized.has(chunkId);
    if(wasMaterialized===value)return;
    if(value)this.materialized.add(chunkId);else this.materialized.delete(chunkId);
    this.invalidateDecisionContext();
    const marker=this.markers.get(chunkId);
    if(marker)marker.visible=!value;
    if(!value)this.wakeChunkDecisionDeadline();
  }

  applyFineSummary(chunkId:string,patch:Partial<Pick<CoarseChunkState,'food'|'wood'|'water'|'ecology'|'danger'|'prosperity'>>) {
    const chunk=this.chunks.get(chunkId);
    if(!chunk)return;
    for(const key of ['food','wood','water','ecology','danger','prosperity'] as const){
      const value=patch[key];
      if(typeof value==='number')chunk[key]=clamp(value);
    }
    this.wakeChunkDecisionDeadline();
  }

  private describeFlow(flow:WorldFlowRecord) {
    const label=flow.kind==='migration'?'migration':flow.kind.replace('_trade','').replace('_spread','');
    return `${label} ${flow.fromChunkId} → ${flow.toChunkId} ${flow.amount.toFixed(2)}`;
  }

  status():CoarseWorldStatus {
    const list=[...this.chunks.values()];
    const avg=(f:(c:CoarseChunkState)=>number)=>list.reduce((s,c)=>s+f(c),0)/Math.max(1,list.length);
    return {
      chunks:list.length,
      decidedChunks:list.filter(c=>c.decisionVersion>0).length,
      pending:this.pending,
      lastSource:this.lastSource,
      lastBatchSize:this.lastBatchSize,
      materializedChunks:this.materialized.size,
      activeChunks:this.activeChunkIds.size,
      activeCenter:`${Number.isFinite(this.activeCenterCx)?this.activeCenterCx:0},${Number.isFinite(this.activeCenterCz)?this.activeCenterCz:0}`,
      recentFlowCount:this.recentFlowLog.length,
      lastFlowSummary:this.recentFlowLog.length?this.describeFlow(this.recentFlowLog[this.recentFlowLog.length-1]!):'—',
      regionDecisions:this.regionPolicies.size,
      worldPriority:this.worldPolicy.priority,
      worldConnectivity:this.worldPolicy.connectivity,
      worldGrowth:this.worldPolicy.growth,
      wildlifePopulation:list.reduce((sum,c)=>sum+(c.wildlife??[]).reduce((count,population)=>count+population.count,0),0),
      plantBiomass:list.reduce((sum,c)=>sum+(c.plants?c.plants.grass+c.plants.shrub+c.plants.fruit+c.plants.crop:0),0)/Math.max(1,list.length),
      trophicPrimary:avg(c=>c.trophicFlux?.primaryProduction||0),
      trophicHerbivory:avg(c=>c.trophicFlux?.herbivory||0),
      trophicPredation:avg(c=>c.trophicFlux?.predation||0),
      nicheCompetition:avg(c=>c.nicheCompetition?.meanPressure||0),
      strongestCompetition:(()=>{
        const pair=list.map(c=>c.nicheCompetition?.strongestPair).filter((x):x is WildlifeCompetitionPair=>Boolean(x))
          .sort((a,b)=>(b?.pressure||0)-(a?.pressure||0))[0];
        return pair?`${pair.speciesA}/${pair.speciesB} ${pair.pressure.toFixed(0)}`:'—';
      })(),
      wildlifeDiseasePressure:avg(c=>c.wildlifeDisease?.meanPressure||0),
      strongestDiseaseTransmission:(()=>{
        const pair=list.map(c=>c.wildlifeDisease?.strongestPair).filter((x):x is WildlifeDiseasePair=>Boolean(x))
          .sort((a,b)=>b.pressure-a.pressure)[0];
        return pair?`${pair.fromSpecies}→${pair.toSpecies} ${pair.pressure.toFixed(0)}`:'—';
      })(),
      wildlifePredatorPressure:avg(c=>c.wildlifePredatorPressure?.meanPressure||0),
      strongestPredatorPressure:(()=>{
        const pair=list.map(c=>c.wildlifePredatorPressure?.strongestPair).filter((x):x is WildlifePredatorPressurePair=>Boolean(x))
          .sort((a,b)=>b.pressure-a.pressure)[0];
        return pair?`${pair.predatorSpecies}→${pair.preySpecies} ${pair.pressure.toFixed(0)}`:'—';
      })(),
      avgPopulation:avg(c=>c.population),
      avgEcology:avg(c=>c.ecology),
      avgProsperity:avg(c=>c.prosperity),
      requestTimeouts:this.requestTimeouts
    };
  }
}
