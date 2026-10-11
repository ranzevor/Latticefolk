import {readNpcContinuation,readWildlifeContinuation} from '../src/world/actorContinuation.js';
import type {
  ChunkBiome, ChunkEcologyPolicy, ChunkMigrationPolicy, ChunkStrategy, DecisionAction, InteractionCapability, ItemKind,
  Mood, NpcRole, ObjectKind, PersistedFineChunk, PersistedWildlifeTransfer, RigidBodyArchetypeId, WildlifeAction,
  WildlifeDeathReason, WildlifeDomesticationCommand, WildlifeOrganismFamily, WildlifePhenotypeProvenance,
  WildlifeSpecies, WildlifeState, WorldPersistenceSnapshot
} from '../src/types.js';
import {DEFAULT_WORLD_SEED} from '../src/world/worldRandom.js';
import {readStreamedLayout,StreamedLayoutValidationError} from '../src/world/streamedLayouts.js';

type RecordLike=Record<string,unknown>;

export const WORLD_SNAPSHOT_LIMITS={
  coarseChunks:200_000,
  fineChunks:50_000,
  homeNpcs:20_000,
  homeObjects:50_000,
  lineage:1_000_000,
  transfers:100_000,
  entitiesPerFineChunk:20_000,
  memoriesPerNpc:2_000,
  tagsPerObject:128,
  inventoryEntries:128
} as const;

const ITEMS=['apple','bread','wood','coin','flower','grain','flour','water','stone','plank','tool'] as const satisfies readonly ItemKind[];
const BIOMES=['plains','forest','hills','wetlands','dryland'] as const satisfies readonly ChunkBiome[];
const STRATEGIES=['sustain','grow_settlement','conserve','extract_resources','fortify','trade_route'] as const satisfies readonly ChunkStrategy[];
const MIGRATION=['attract','retain','release','evacuate'] as const satisfies readonly ChunkMigrationPolicy[];
const ECOLOGY=['recover','balance','harvest','protect'] as const satisfies readonly ChunkEcologyPolicy[];
const NPC_ROLES=['farmer','baker','shopkeeper','guard','maker','resident'] as const satisfies readonly NpcRole[];
const MOODS=['happy','calm','neutral','sad','annoyed','curious','tired'] as const satisfies readonly Mood[];
const ACTIONS=['idle','wander','talk','work','rest','eat','pickup','use_object','inspect','drop_item','harvest','craft','trade','gift','deliver','fetch_water','patrol','visit','sleep','explore'] as const satisfies readonly DecisionAction[];
const OBJECT_KINDS=['bed','bench','workstation','food_stall','tree','crate','well','water_patch','farm_plot','building','road','bush','rock','flower','cart','tool_prop','dropped_item'] as const satisfies readonly ObjectKind[];
const CAPABILITIES=['inspect','rest','sit','sleep','draw_water','drink','wash','harvest','forage','chop','mine','craft','work','buy','sell','trade','store','take','load','unload','pickup','visit'] as const satisfies readonly InteractionCapability[];
const RIGID_BODIES=['cart'] as const satisfies readonly RigidBodyArchetypeId[];
const SPECIES=['rabbit','deer','boar','goat','fox','wolf','badger','lynx','bison','raccoon','sheep','warg'] as const satisfies readonly WildlifeSpecies[];
const WILDLIFE_ACTIONS=['graze','forage','drink','rest','flee','hunt','wander','seek_mate','migrate'] as const satisfies readonly WildlifeAction[];
const DEATH_REASONS=['predation','starvation','dehydration','disease','senescence','other'] as const satisfies readonly WildlifeDeathReason[];
const DOMESTICATION_COMMANDS=['none','follow','stay','graze'] as const satisfies readonly WildlifeDomesticationCommand[];
const ORGANISM_FAMILIES=['lagomorph','cervid','suiform','caprine','canid','mustelid','felid','bovid','procyonid'] as const satisfies readonly WildlifeOrganismFamily[];
const PHENOTYPE_PROVENANCE=['birth','founder_seed','legacy_upgrade'] as const satisfies readonly WildlifePhenotypeProvenance[];
const WEATHER=['clear','cloudy','rain'] as const;
const SEX=['female','male'] as const;
const LINEAGE_ORIGIN=['founder','reproduction'] as const;
const MIGRATION_REASON=['behavioral_migration','owner_follow'] as const;

const itemSet=new Set<string>(ITEMS);
const speciesSet=new Set<string>(SPECIES);
const biomeSet=new Set<string>(BIOMES);

const isRecord=(value:unknown):value is RecordLike=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const hasOwn=(value:RecordLike,key:string)=>Object.prototype.hasOwnProperty.call(value,key);

export class WorldSnapshotValidationError extends Error {
  constructor(readonly issues:string[]){
    super(`Invalid world persistence payload: ${issues.slice(0,8).join('; ')}${issues.length>8?` (+${issues.length-8} more)`:''}`);
    this.name='WorldSnapshotValidationError';
  }
}

class Validator {
  readonly issues:string[]=[];
  private readonly maxIssues=128;

  issue(path:string,message:string){
    if(this.issues.length<this.maxIssues)this.issues.push(`${path}: ${message}`);
  }

  record(value:unknown,path:string):RecordLike|undefined {
    if(!isRecord(value)){this.issue(path,'expected object');return undefined;}
    return value;
  }

  array(value:unknown,path:string,max:number):unknown[]|undefined {
    if(!Array.isArray(value)){this.issue(path,'expected array');return undefined;}
    if(value.length>max){this.issue(path,`too many entries (${value.length} > ${max})`);return undefined;}
    return value;
  }

  string(value:unknown,path:string,{nonEmpty=true,max=512}:{nonEmpty?:boolean;max?:number}={}):string|undefined {
    if(typeof value!=='string'){this.issue(path,'expected string');return undefined;}
    if(nonEmpty&&!value.trim())this.issue(path,'must not be empty');
    if(value.length>max)this.issue(path,`string too long (${value.length} > ${max})`);
    return value;
  }

  bool(value:unknown,path:string):boolean|undefined {
    if(typeof value!=='boolean'){this.issue(path,'expected boolean');return undefined;}
    return value;
  }

  number(value:unknown,path:string,{min,max,integer=false}:{min?:number;max?:number;integer?:boolean}={}):number|undefined {
    if(typeof value!=='number'||!Number.isFinite(value)){this.issue(path,'expected finite number');return undefined;}
    if(integer&&!Number.isInteger(value))this.issue(path,'expected integer');
    if(min!==undefined&&value<min)this.issue(path,`must be >= ${min}`);
    if(max!==undefined&&value>max)this.issue(path,`must be <= ${max}`);
    return value;
  }

  enum<T extends readonly string[]>(value:unknown,path:string,allowed:T):T[number]|undefined {
    const s=this.string(value,path,{max:128});if(s===undefined)return undefined;
    if(!(allowed as readonly string[]).includes(s)){this.issue(path,`unsupported value "${s}"`);return undefined;}
    return s as T[number];
  }

  optionalNumber(obj:RecordLike,key:string,path:string,opts:{}|{min?:number;max?:number;integer?:boolean}={}){
    if(hasOwn(obj,key)&&obj[key]!==undefined)this.number(obj[key],`${path}.${key}`,opts);
  }

  optionalString(obj:RecordLike,key:string,path:string,max=512){
    if(hasOwn(obj,key)&&obj[key]!==undefined)this.string(obj[key],`${path}.${key}`,{max});
  }

  jsonCompatible(value:unknown,path:string,depth=0){
    if(depth>24){this.issue(path,'nested value exceeds depth 24');return;}
    if(value===null||value===undefined||typeof value==='string'||typeof value==='boolean')return;
    if(typeof value==='number'){if(!Number.isFinite(value))this.issue(path,'contains non-finite number');return;}
    if(Array.isArray(value)){
      if(value.length>100_000){this.issue(path,'nested array too large');return;}
      value.forEach((entry,index)=>this.jsonCompatible(entry,`${path}[${index}]`,depth+1));
      return;
    }
    if(isRecord(value)){
      const entries=Object.entries(value);
      if(entries.length>10_000){this.issue(path,'nested object has too many keys');return;}
      for(const [key,entry] of entries){
        if(key.length>256){this.issue(path,'nested object key too long');continue;}
        this.jsonCompatible(entry,`${path}.${key}`,depth+1);
      }
      return;
    }
    this.issue(path,`unsupported non-JSON value type ${typeof value}`);
  }
}

const validateVec2=(v:Validator,value:unknown,path:string)=>{
  const obj=v.record(value,path);if(!obj)return;
  v.number(obj.x,`${path}.x`);
  v.number(obj.z,`${path}.z`);
};

const validateInventory=(v:Validator,value:unknown,path:string)=>{
  const obj=v.record(value,path);if(!obj)return;
  const entries=Object.entries(obj);
  if(entries.length>WORLD_SNAPSHOT_LIMITS.inventoryEntries)v.issue(path,'too many inventory keys');
  for(const [key,count] of entries){
    if(!itemSet.has(key))v.issue(`${path}.${key}`,'unsupported item kind');
    v.number(count,`${path}.${key}`,{min:0});
  }
};

const validateInventoryArray=(v:Validator,value:unknown,path:string)=>{
  const list=v.array(value,path,WORLD_SNAPSHOT_LIMITS.inventoryEntries);if(!list)return;
  const seen=new Set<string>();
  list.forEach((entry,index)=>{
    const p=`${path}[${index}]`,obj=v.record(entry,p);if(!obj)return;
    const kind=v.enum(obj.kind,`${p}.kind`,ITEMS);
    v.number(obj.count,`${p}.count`,{min:0});
    if(kind){if(seen.has(kind))v.issue(`${p}.kind`,'duplicate inventory item');seen.add(kind);}
  });
};

const validateTraits=(v:Validator,value:unknown,path:string)=>{
  const obj=v.record(value,path);if(!obj)return;
  for(const key of ['speed','size','fertility','wariness'] as const)v.number(obj[key],`${path}.${key}`,{min:0,max:100});
};

const validatePhenotype=(v:Validator,value:unknown,path:string)=>{
  const obj=v.record(value,path);if(!obj)return;
  const morphology=v.record(obj.morphology,`${path}.morphology`);
  if(morphology)for(const key of ['bodyLength','bodyHeight','legLength','headScale','tailScale'] as const)v.number(morphology[key],`${path}.morphology.${key}`,{min:0.05,max:20});
  const behavior=v.record(obj.behavior,`${path}.behavior`);
  if(behavior)for(const key of ['forageDrive','migrationDrive','riskTolerance','recoveryDrive'] as const)v.number(behavior[key],`${path}.behavior.${key}`,{min:0,max:20});
};

const validateGenome=(v:Validator,value:unknown,path:string)=>{
  const obj=v.record(value,path);if(!obj)return;
  v.enum(obj.family,`${path}.family`,ORGANISM_FAMILIES);
  for(const section of ['material','niche','locomotion'] as const){
    const nested=v.record(obj[section],`${path}.${section}`);if(!nested)continue;
    const keys=section==='material'?['hueShift','lightnessShift','accentShift']:section==='niche'?['grass','shrub','fruit','crop']:['stride','endurance'];
    for(const key of keys)v.number(nested[key],`${path}.${section}.${key}`,{min:section==='material'?-10:0,max:20});
  }
};

const validateDomestication=(v:Validator,value:unknown,path:string)=>{
  const obj=v.record(value,path);if(!obj)return;
  v.number(obj.tameProgress,`${path}.tameProgress`,{min:0,max:100});
  if(obj.ownerId!==undefined)v.string(obj.ownerId,`${path}.ownerId`,{max:256});
  v.enum(obj.command,`${path}.command`,DOMESTICATION_COMMANDS);
  v.bool(obj.breedingAllowed,`${path}.breedingAllowed`);
  v.optionalNumber(obj,'claimedDay',path,{min:0});
  v.optionalNumber(obj,'lastInteractionDay',path,{min:0});
};

const validateNpc=(v:Validator,value:unknown,path:string,expectedChunk:string|undefined)=>{
  const obj=v.record(value,path);if(!obj)return;
  v.string(obj.id,`${path}.id`,{max:256});
  v.optionalNumber(obj,'randomEventCursor',path,{min:0,max:Number.MAX_SAFE_INTEGER,integer:true});
  try{readNpcContinuation(obj.continuation);}catch{v.issue(`${path}.continuation`,'invalid NPC continuation');}
  if(obj.chunkId!==undefined){
    const chunk=v.string(obj.chunkId,`${path}.chunkId`,{max:256});
    if(expectedChunk!==undefined&&chunk!==expectedChunk)v.issue(`${path}.chunkId`,`must match parent chunk ${expectedChunk}`);
    if(expectedChunk===undefined)v.issue(`${path}.chunkId`,'home NPC must not declare a fine chunk');
  }
  v.string(obj.name,`${path}.name`,{max:256});
  v.enum(obj.role,`${path}.role`,NPC_ROLES);
  validateVec2(v,obj.position,`${path}.position`);
  if(obj.heading!==undefined)v.number(obj.heading,`${path}.heading`);
  validateVec2(v,obj.home,`${path}.home`);
  if(obj.workAt!==undefined)v.string(obj.workAt,`${path}.workAt`,{max:256});
  v.enum(obj.mood,`${path}.mood`,MOODS);
  for(const key of ['hunger','energy','social'] as const)v.number(obj[key],`${path}.${key}`,{min:0,max:100});
  v.number(obj.money,`${path}.money`,{min:0});
  validateInventoryArray(v,obj.inventory,`${path}.inventory`);
  const relationships=v.record(obj.relationships,`${path}.relationships`);
  if(relationships)for(const [id,state] of Object.entries(relationships)){
    if(!id||id.length>256)v.issue(`${path}.relationships`,'invalid relationship id');
    const rel=v.record(state,`${path}.relationships.${id}`);if(!rel)continue;
    for(const key of ['affinity','trust','familiarity'] as const)v.number(rel[key],`${path}.relationships.${id}.${key}`,{min:-1000,max:1000});
  }
  const memories=v.array(obj.memories,`${path}.memories`,WORLD_SNAPSHOT_LIMITS.memoriesPerNpc);
  if(memories)memories.forEach((memory,index)=>{
    const p=`${path}.memories[${index}]`,m=v.record(memory,p);if(!m)return;
    v.string(m.id,`${p}.id`,{max:256});v.number(m.at,`${p}.at`,{min:0});
    v.string(m.summary,`${p}.summary`,{max:4096});v.number(m.importance,`${p}.importance`,{min:0,max:100});
  });
  v.enum(obj.currentAction,`${path}.currentAction`,ACTIONS);
  v.optionalString(obj,'targetNpcId',path,256);v.optionalString(obj,'targetObjectId',path,256);
  v.string(obj.goal,`${path}.goal`,{nonEmpty:false,max:4096});
  v.number(obj.lastDecisionAt,`${path}.lastDecisionAt`,{min:0});
  v.optionalString(obj,'lastDialogue',path,8192);
  v.jsonCompatible(obj,path);
};

const validateObject=(v:Validator,value:unknown,path:string,expectedChunk:string|undefined)=>{
  const obj=v.record(value,path);if(!obj)return;
  v.string(obj.id,`${path}.id`,{max:256});
  if(obj.chunkId!==undefined){
    const chunk=v.string(obj.chunkId,`${path}.chunkId`,{max:256});
    if(expectedChunk!==undefined&&chunk!==expectedChunk)v.issue(`${path}.chunkId`,`must match parent chunk ${expectedChunk}`);
    if(expectedChunk===undefined)v.issue(`${path}.chunkId`,'home object must not declare a fine chunk');
  }
  v.enum(obj.kind,`${path}.kind`,OBJECT_KINDS);
  v.string(obj.name,`${path}.name`,{max:256});
  validateVec2(v,obj.position,`${path}.position`);
  const tags=v.array(obj.tags,`${path}.tags`,WORLD_SNAPSHOT_LIMITS.tagsPerObject);
  if(tags)tags.forEach((tag,index)=>v.string(tag,`${path}.tags[${index}]`,{max:128}));
  v.bool(obj.usable,`${path}.usable`);v.bool(obj.pickupable,`${path}.pickupable`);
  if(obj.rigidBodyArchetype!==undefined)v.enum(obj.rigidBodyArchetype,`${path}.rigidBodyArchetype`,RIGID_BODIES);
  if(obj.movable!==undefined)v.bool(obj.movable,`${path}.movable`);
  v.optionalNumber(obj,'physicsRadius',path,{min:0.01,max:100});
  if(obj.item!==undefined)v.enum(obj.item,`${path}.item`,ITEMS);
  if(obj.capabilities!==undefined){
    const caps=v.array(obj.capabilities,`${path}.capabilities`,CAPABILITIES.length);
    if(caps){const seen=new Set<string>();caps.forEach((cap,index)=>{const c=v.enum(cap,`${path}.capabilities[${index}]`,CAPABILITIES);if(c){if(seen.has(c))v.issue(`${path}.capabilities[${index}]`,'duplicate capability');seen.add(c);}});}
  }
  if(obj.storage!==undefined)validateInventoryArray(v,obj.storage,`${path}.storage`);
  v.optionalNumber(obj,'resourceAmount',path,{min:0});v.optionalNumber(obj,'resourceCapacity',path,{min:0});
  if(typeof obj.resourceAmount==='number'&&Number.isFinite(obj.resourceAmount)&&typeof obj.resourceCapacity==='number'&&Number.isFinite(obj.resourceCapacity)&&obj.resourceAmount>obj.resourceCapacity)v.issue(`${path}.resourceAmount`,'must not exceed resourceCapacity');
  v.optionalNumber(obj,'respawnAt',path,{min:0});v.optionalString(obj,'occupiedBy',path,256);
  v.jsonCompatible(obj,path);
};

const validateWildlife=(v:Validator,value:unknown,path:string,expectedChunk?:string):WildlifeState|undefined=>{
  const obj=v.record(value,path);if(!obj)return undefined;
  v.string(obj.id,`${path}.id`,{max:256});
  v.optionalNumber(obj,'randomEventCursor',path,{min:0,max:Number.MAX_SAFE_INTEGER,integer:true});
  try{readWildlifeContinuation(obj.continuation);}catch{v.issue(`${path}.continuation`,'invalid wildlife continuation');}
  const chunk=v.string(obj.chunkId,`${path}.chunkId`,{max:256});
  if(expectedChunk!==undefined&&chunk!==expectedChunk)v.issue(`${path}.chunkId`,`must match parent/destination chunk ${expectedChunk}`);
  v.enum(obj.species,`${path}.species`,SPECIES);
  validateVec2(v,obj.position,`${path}.position`);
  v.number(obj.ageDays,`${path}.ageDays`,{min:0});
  for(const key of ['health','hunger','thirst','energy'] as const)v.number(obj[key],`${path}.${key}`,{min:0,max:100});
  v.enum(obj.sex,`${path}.sex`,SEX);
  v.number(obj.generation,`${path}.generation`,{min:0,integer:true});
  validateTraits(v,obj.traits,`${path}.traits`);
  if(obj.phenotype!==undefined)validatePhenotype(v,obj.phenotype,`${path}.phenotype`);
  if(obj.organismGenome!==undefined)validateGenome(v,obj.organismGenome,`${path}.organismGenome`);
  if(obj.domestication!==undefined)validateDomestication(v,obj.domestication,`${path}.domestication`);
  v.enum(obj.currentAction,`${path}.currentAction`,WILDLIFE_ACTIONS);
  for(const key of ['targetObjectId','targetWildlifeId','targetChunkId','motherId','fatherId','pregnantById'] as const)v.optionalString(obj,key,path,256);
  v.number(obj.lastDecisionAt,`${path}.lastDecisionAt`,{min:0});
  v.number(obj.birthDay,`${path}.birthDay`,{min:0});
  v.optionalNumber(obj,'diseaseLoad',path,{min:0,max:100});
  v.optionalNumber(obj,'pregnantUntilDay',path,{min:0});v.optionalNumber(obj,'lastBirthDay',path,{min:0});
  v.optionalNumber(obj,'representedPopulation',path,{min:0});
  v.jsonCompatible(obj,path);
  return obj as unknown as WildlifeState;
};

const validateCoarse=(v:Validator,value:unknown,path:string)=>{
  const obj=v.record(value,path);if(!obj)return;
  v.string(obj.id,`${path}.id`,{max:256});
  v.number(obj.cx,`${path}.cx`,{integer:true,min:-10_000_000,max:10_000_000});
  v.number(obj.cz,`${path}.cz`,{integer:true,min:-10_000_000,max:10_000_000});
  v.enum(obj.biome,`${path}.biome`,BIOMES);
  v.number(obj.settlementLevel,`${path}.settlementLevel`,{integer:true,min:0,max:3});
  v.number(obj.population,`${path}.population`,{min:0});
  for(const key of ['food','wood','water','ecology','danger','prosperity'] as const)v.number(obj[key],`${path}.${key}`,{min:0,max:100});
  v.enum(obj.strategy,`${path}.strategy`,STRATEGIES);
  v.enum(obj.migrationPolicy,`${path}.migrationPolicy`,MIGRATION);
  v.enum(obj.ecologyPolicy,`${path}.ecologyPolicy`,ECOLOGY);
  v.number(obj.lastDecisionAt,`${path}.lastDecisionAt`,{min:0});
  v.number(obj.decisionVersion,`${path}.decisionVersion`,{min:0,integer:true});
  if(obj.wildlife!==undefined){
    const list=v.array(obj.wildlife,`${path}.wildlife`,SPECIES.length);
    if(list){const seen=new Set<string>();list.forEach((entry,index)=>{
      const p=`${path}.wildlife[${index}]`,w=v.record(entry,p);if(!w)return;
      const species=v.enum(w.species,`${p}.species`,SPECIES);
      v.number(w.count,`${p}.count`,{min:0});v.number(w.carryingCapacity,`${p}.carryingCapacity`,{min:0});
      v.number(w.health,`${p}.health`,{min:0,max:100});
      for(const key of ['diseaseLoad','competitionPressure','importedDiseasePressure','predatorPressure'] as const)v.optionalNumber(w,key,p,{min:0,max:100});
      if(species){if(seen.has(species))v.issue(`${p}.species`,'duplicate species population');seen.add(species);}
    });}
  }
  v.jsonCompatible(obj,path);
};

const validateLineage=(v:Validator,value:unknown,path:string)=>{
  const obj=v.record(value,path);if(!obj)return;
  const id=v.string(obj.entityId,`${path}.entityId`,{max:256});
  v.enum(obj.species,`${path}.species`,SPECIES);
  const mother=obj.motherId===undefined?undefined:v.string(obj.motherId,`${path}.motherId`,{max:256});
  const father=obj.fatherId===undefined?undefined:v.string(obj.fatherId,`${path}.fatherId`,{max:256});
  if(id&&(mother===id||father===id))v.issue(path,'lineage entity cannot be its own parent');
  const birth=v.number(obj.birthDay,`${path}.birthDay`,{min:0});
  const death=obj.deathDay===undefined?undefined:v.number(obj.deathDay,`${path}.deathDay`,{min:0});
  if(birth!==undefined&&death!==undefined&&death<birth)v.issue(`${path}.deathDay`,'must not precede birthDay');
  if(obj.deathReason!==undefined)v.enum(obj.deathReason,`${path}.deathReason`,DEATH_REASONS);
  v.number(obj.generation,`${path}.generation`,{min:0,integer:true});
  v.string(obj.birthChunk,`${path}.birthChunk`,{max:256});v.optionalString(obj,'deathChunk',path,256);
  validateTraits(v,obj.traitsAtBirth,`${path}.traitsAtBirth`);
  if(obj.traitsAtDeath!==undefined)validateTraits(v,obj.traitsAtDeath,`${path}.traitsAtDeath`);
  if(obj.phenotypeAtBirth!==undefined)validatePhenotype(v,obj.phenotypeAtBirth,`${path}.phenotypeAtBirth`);
  if(obj.phenotypeAtDeath!==undefined)validatePhenotype(v,obj.phenotypeAtDeath,`${path}.phenotypeAtDeath`);
  if(obj.phenotypeProvenance!==undefined)v.enum(obj.phenotypeProvenance,`${path}.phenotypeProvenance`,PHENOTYPE_PROVENANCE);
  if(obj.organismGenomeAtBirth!==undefined)validateGenome(v,obj.organismGenomeAtBirth,`${path}.organismGenomeAtBirth`);
  if(obj.organismGenomeAtDeath!==undefined)validateGenome(v,obj.organismGenomeAtDeath,`${path}.organismGenomeAtDeath`);
  if(obj.organismGenomeProvenance!==undefined)v.enum(obj.organismGenomeProvenance,`${path}.organismGenomeProvenance`,PHENOTYPE_PROVENANCE);
  if(obj.domesticationAtBirth!==undefined)validateDomestication(v,obj.domesticationAtBirth,`${path}.domesticationAtBirth`);
  if(obj.domesticationAtDeath!==undefined)validateDomestication(v,obj.domesticationAtDeath,`${path}.domesticationAtDeath`);
  if(obj.birthHabitat!==undefined)validateHabitat(v,obj.birthHabitat,`${path}.birthHabitat`);
  if(obj.deathHabitat!==undefined)validateHabitat(v,obj.deathHabitat,`${path}.deathHabitat`);
  if(obj.habitatExposure!==undefined)validateExposure(v,obj.habitatExposure,`${path}.habitatExposure`);
  if(obj.migrationHistory!==undefined){
    const history=v.array(obj.migrationHistory,`${path}.migrationHistory`,100_000);
    if(history)history.forEach((event,index)=>{
      const p=`${path}.migrationHistory[${index}]`,m=v.record(event,p);if(!m)return;
      const from=v.string(m.fromChunkId,`${p}.fromChunkId`,{max:256});
      const to=v.string(m.toChunkId,`${p}.toChunkId`,{max:256});
      if(from&&to&&from===to)v.issue(p,'migration source and destination must differ');
      v.number(m.day,`${p}.day`,{min:0});
      v.enum(m.fromBiome,`${p}.fromBiome`,BIOMES);v.enum(m.toBiome,`${p}.toBiome`,BIOMES);
      v.number(m.representedPopulation,`${p}.representedPopulation`,{min:0});
      v.enum(m.reason,`${p}.reason`,MIGRATION_REASON);
    });
  }
  if(obj.predationOutcomes!==undefined)v.jsonCompatible(obj.predationOutcomes,`${path}.predationOutcomes`);
  v.enum(obj.origin,`${path}.origin`,LINEAGE_ORIGIN);
  v.number(obj.offspringCount,`${path}.offspringCount`,{min:0,integer:true});
  v.bool(obj.reproductiveSuccess,`${path}.reproductiveSuccess`);
  v.jsonCompatible(obj,path);
};

function validateHabitat(v:Validator,value:unknown,path:string){
  const obj=v.record(value,path);if(!obj)return;
  v.enum(obj.biome,`${path}.biome`,BIOMES);
  for(const key of ['ecology','food','water','danger','plantBiomass'] as const)v.number(obj[key],`${path}.${key}`,{min:0,max:key==='plantBiomass'?10_000:100});
  v.number(obj.settlementLevel,`${path}.settlementLevel`,{min:0,integer:true,max:3});
  for(const key of ['competitionPressure','seasonalSuitability','diseasePressure','predatorPressure'] as const)v.optionalNumber(obj,key,path,{min:0,max:100});
}

function validateSpeciesMap(v:Validator,value:unknown,path:string){
  const obj=v.record(value,path);if(!obj)return;
  for(const [key,val] of Object.entries(obj)){if(!speciesSet.has(key))v.issue(`${path}.${key}`,'unsupported wildlife species');v.number(val,`${path}.${key}`,{min:0});}
}

function validateExposure(v:Validator,value:unknown,path:string){
  const obj=v.record(value,path);if(!obj)return;
  v.number(obj.observedDays,`${path}.observedDays`,{min:0});
  const mean=v.record(obj.habitatMean,`${path}.habitatMean`);
  if(mean){
    for(const key of ['ecology','food','water','danger','settlementLevel','plantBiomass','competitionPressure','seasonalSuitability','diseasePressure','predatorPressure'] as const){
      if(mean[key]!==undefined)v.number(mean[key],`${path}.habitatMean.${key}`,{min:0,max:key==='plantBiomass'?10_000:key==='settlementLevel'?3:100});
    }
  }
  for(const key of ['predatorSourceMean','competitionSourceMean','diseaseSourceMean'] as const)if(obj[key]!==undefined)validateSpeciesMap(v,obj[key],`${path}.${key}`);
  for(const key of ['predatorSourceObservedDays','competitionSourceObservedDays','diseaseSourceObservedDays','lastObservedDay'] as const)v.optionalNumber(obj,key,path,{min:0});
  const biomeDays=v.record(obj.biomeDays,`${path}.biomeDays`);
  if(biomeDays)for(const [key,val] of Object.entries(biomeDays)){if(!biomeSet.has(key))v.issue(`${path}.biomeDays.${key}`,'unsupported biome');v.number(val,`${path}.biomeDays.${key}`,{min:0});}
  const chunkDays=v.record(obj.chunkDays,`${path}.chunkDays`);
  if(chunkDays)for(const [key,val] of Object.entries(chunkDays)){if(!key||key.length>256)v.issue(`${path}.chunkDays`,'invalid chunk id');v.number(val,`${path}.chunkDays.${key}`,{min:0});}
  v.number(obj.observedTransitions,`${path}.observedTransitions`,{min:0,integer:true});
  v.optionalString(obj,'lastChunk',path,256);if(obj.lastBiome!==undefined)v.enum(obj.lastBiome,`${path}.lastBiome`,BIOMES);
}

export function validateWorldPersistenceSnapshot(input:unknown):WorldPersistenceSnapshot {
  const v=new Validator();
  const root=v.record(input,'snapshot');
  if(!root)throw new WorldSnapshotValidationError(v.issues);

  if(root.version!==1)v.issue('snapshot.version','expected version 1');
  const meta=v.record(root.meta,'snapshot.meta');
  if(meta){
    if(meta.randomness!==undefined){
      const randomness=v.record(meta.randomness,'snapshot.meta.randomness');
      if(randomness){
        if(randomness.version!==1)v.issue('snapshot.meta.randomness.version','unsupported version');
        v.string(randomness.seed,'snapshot.meta.randomness.seed',{max:256});
      }
    }
    v.number(meta.day,'snapshot.meta.day',{min:0});
    v.number(meta.minuteOfDay,'snapshot.meta.minuteOfDay',{min:0,max:1439.999999});
    v.enum(meta.weather,'snapshot.meta.weather',WEATHER);
    v.optionalNumber(meta,'weatherEpoch','snapshot.meta',{min:-1,max:3,integer:true});
    validateVec2(v,meta.playerPosition,'snapshot.meta.playerPosition');
    validateInventory(v,meta.playerInventory,'snapshot.meta.playerInventory');
  }

  const coarse=v.array(root.coarseChunks,'snapshot.coarseChunks',WORLD_SNAPSHOT_LIMITS.coarseChunks);
  const coarseIds=new Set<string>(),coords=new Set<string>();
  if(coarse)coarse.forEach((chunk,index)=>{
    const p=`snapshot.coarseChunks[${index}]`;validateCoarse(v,chunk,p);
    if(isRecord(chunk)){
      if(typeof chunk.id==='string'){if(coarseIds.has(chunk.id))v.issue(`${p}.id`,'duplicate coarse chunk id');coarseIds.add(chunk.id);}
      if(Number.isInteger(chunk.cx)&&Number.isInteger(chunk.cz)){const key=`${chunk.cx},${chunk.cz}`;if(coords.has(key))v.issue(p,`duplicate coarse chunk coordinate ${key}`);coords.add(key);}
    }
  });

  const fine=v.array(root.fineChunks,'snapshot.fineChunks',WORLD_SNAPSHOT_LIMITS.fineChunks);
  const fineIds=new Set<string>(),npcIds=new Set<string>(),objectIds=new Set<string>(),wildlifeIds=new Set<string>();
  if(fine)fine.forEach((chunk,index)=>{
    const p=`snapshot.fineChunks[${index}]`,obj=v.record(chunk,p);if(!obj)return;
    const chunkId=v.string(obj.chunkId,`${p}.chunkId`,{max:256});
    if(chunkId){if(fineIds.has(chunkId))v.issue(`${p}.chunkId`,'duplicate fine chunk');fineIds.add(chunkId);}
    const npcs=v.array(obj.npcStates,`${p}.npcStates`,WORLD_SNAPSHOT_LIMITS.entitiesPerFineChunk);
    if(npcs)npcs.forEach((npc,n)=>{validateNpc(v,npc,`${p}.npcStates[${n}]`,chunkId);if(isRecord(npc)&&typeof npc.id==='string'){if(npcIds.has(npc.id))v.issue(`${p}.npcStates[${n}].id`,'duplicate NPC id');npcIds.add(npc.id);}});
    const objects=v.array(obj.objectStates,`${p}.objectStates`,WORLD_SNAPSHOT_LIMITS.entitiesPerFineChunk);
    if(objects)objects.forEach((state,n)=>{validateObject(v,state,`${p}.objectStates[${n}]`,chunkId);if(isRecord(state)&&typeof state.id==='string'){if(objectIds.has(state.id))v.issue(`${p}.objectStates[${n}].id`,'duplicate object id');objectIds.add(state.id);}});
    if(obj.wildlifeStates!==undefined){
      const wildlife=v.array(obj.wildlifeStates,`${p}.wildlifeStates`,WORLD_SNAPSHOT_LIMITS.entitiesPerFineChunk);
      if(wildlife)wildlife.forEach((state,n)=>{validateWildlife(v,state,`${p}.wildlifeStates[${n}]`,chunkId);if(isRecord(state)&&typeof state.id==='string'){if(wildlifeIds.has(state.id))v.issue(`${p}.wildlifeStates[${n}].id`,'duplicate wildlife id');wildlifeIds.add(state.id);}});
    }
  });

  const homeNpcs=v.array(root.homeNpcs,'snapshot.homeNpcs',WORLD_SNAPSHOT_LIMITS.homeNpcs);
  if(homeNpcs)homeNpcs.forEach((npc,index)=>{const p=`snapshot.homeNpcs[${index}]`;validateNpc(v,npc,p,undefined);if(isRecord(npc)&&typeof npc.id==='string'){if(npcIds.has(npc.id))v.issue(`${p}.id`,'duplicate NPC id');npcIds.add(npc.id);}});
  const homeObjects=v.array(root.homeObjects,'snapshot.homeObjects',WORLD_SNAPSHOT_LIMITS.homeObjects);
  if(homeObjects)homeObjects.forEach((state,index)=>{const p=`snapshot.homeObjects[${index}]`;validateObject(v,state,p,undefined);if(isRecord(state)&&typeof state.id==='string'){if(objectIds.has(state.id))v.issue(`${p}.id`,'duplicate object id');objectIds.add(state.id);}});

  const lineage=root.wildlifeLineage===undefined?undefined:v.array(root.wildlifeLineage,'snapshot.wildlifeLineage',WORLD_SNAPSHOT_LIMITS.lineage);
  const lineageIds=new Set<string>();
  if(lineage)lineage.forEach((record,index)=>{const p=`snapshot.wildlifeLineage[${index}]`;validateLineage(v,record,p);if(isRecord(record)&&typeof record.entityId==='string'){if(lineageIds.has(record.entityId))v.issue(`${p}.entityId`,'duplicate lineage entity id');lineageIds.add(record.entityId);}});

  const transfers=root.wildlifeTransfers===undefined?undefined:v.array(root.wildlifeTransfers,'snapshot.wildlifeTransfers',WORLD_SNAPSHOT_LIMITS.transfers);
  const transferIds=new Set<string>();
  if(transfers)transfers.forEach((transfer,index)=>{
    const p=`snapshot.wildlifeTransfers[${index}]`,obj=v.record(transfer,p);if(!obj)return;
    const id=v.string(obj.entityId,`${p}.entityId`,{max:256});
    const from=v.string(obj.fromChunkId,`${p}.fromChunkId`,{max:256});
    const to=v.string(obj.toChunkId,`${p}.toChunkId`,{max:256});
    if(id){if(transferIds.has(id))v.issue(`${p}.entityId`,'duplicate transfer entity id');transferIds.add(id);if(wildlifeIds.has(id))v.issue(`${p}.entityId`,'wildlife cannot be both materialized and in transit');}
    if(from&&to&&from===to)v.issue(p,'transfer source and destination must differ');
    const represented=v.number(obj.representedPopulation,`${p}.representedPopulation`,{min:Number.EPSILON});
    v.number(obj.transferredDay,`${p}.transferredDay`,{min:0});
    const state=validateWildlife(v,obj.state,`${p}.state`,to);
    if(state&&id&&state.id!==id)v.issue(`${p}.state.id`,'must equal transfer entityId');
    if(state&&represented!==undefined&&state.representedPopulation!==undefined&&Math.abs(state.representedPopulation-represented)>1e-9)v.issue(`${p}.state.representedPopulation`,'must match transfer representedPopulation');
  });

  if(root.savedAt!==undefined)v.number(root.savedAt,'snapshot.savedAt',{min:0});
  if(isRecord(root.meta)&&root.meta.streamedLayoutVersion!==undefined&&root.meta.streamedLayoutVersion!==1)v.issue('snapshot.meta.streamedLayoutVersion','unsupported version');
  if(root.streamedLayouts!==undefined){
    const layouts=v.array(root.streamedLayouts,'snapshot.streamedLayouts',WORLD_SNAPSHOT_LIMITS.fineChunks),seen=new Set<string>();
    if(layouts?.length&&meta?.streamedLayoutVersion!==1)v.issue('snapshot.meta.streamedLayoutVersion','required for streamed layouts');
    for(const [index,layout] of (layouts||[]).entries()){
      try{
        const value=readStreamedLayout(layout);
        const worldSeed=isRecord(meta?.randomness)&&typeof meta.randomness.seed==='string'?meta.randomness.seed:DEFAULT_WORLD_SEED;
        if(value.seed!==worldSeed)v.issue(`snapshot.streamedLayouts[${index}].seed`,'must match the world random seed');
        if(seen.has(value.unit.id))v.issue(`snapshot.streamedLayouts[${index}]`,'duplicate unit');seen.add(value.unit.id);
      }catch(error){if(error instanceof StreamedLayoutValidationError)v.issue(`snapshot.streamedLayouts[${index}]`,error.message);else throw error;}
    }
  }
  for(const [index,chunk] of (Array.isArray(root.fineChunks)?root.fineChunks:[]).entries()){
    if(isRecord(chunk)&&chunk.dynamicActivated!==undefined){
      v.bool(chunk.dynamicActivated,`snapshot.fineChunks[${index}].dynamicActivated`);
      if(meta?.streamedLayoutVersion!==1)v.issue('snapshot.meta.streamedLayoutVersion','required for owner activation state');
      if(chunk.dynamicActivated===false&&((Array.isArray(chunk.npcStates)&&chunk.npcStates.length)||(Array.isArray(chunk.wildlifeStates)&&chunk.wildlifeStates.length)))v.issue(`snapshot.fineChunks[${index}]`,'static-only owner cannot contain activated actors');
    }
  }

  if(v.issues.length)throw new WorldSnapshotValidationError(v.issues);
  return input as WorldPersistenceSnapshot;
}

