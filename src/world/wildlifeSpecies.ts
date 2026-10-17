import type { ChunkBiome, WildlifeAction, WildlifeOrganismFamily, WildlifeSpecies, WorldSeason, WorldObjectState } from '../types.js';
import { composeWildlifeSpeciesProfile, WILDLIFE_BODY_ARCHETYPES, WILDLIFE_CAPABILITY_ARCHETYPES, WILDLIFE_ECOLOGY_ARCHETYPES, WILDLIFE_FORM_ARCHETYPES, WILDLIFE_HABITAT_ARCHETYPES, WILDLIFE_LIFE_ARCHETYPES, WILDLIFE_MOVEMENT_ARCHETYPES } from './wildlifeArchetypes.js';

export type WildlifeTrophicRole='herbivore'|'omnivore'|'predator';
export type WildlifeNicheAxis='grass'|'shrub'|'fruit'|'crop'|'prey'|'space';
export type WildlifeMorphologyFeature='long_ears'|'antlers'|'horns'|'tail'|'dorsal_stripe'|'ear_tufts'|'face_mask'|'ringed_tail';
export type WildlifeMovementMode='generalist'|'cursorial'|'ambush'|'sturdy'|'heavy_grazer'|'dexterous_forager';
export type WildlifeGait='amble'|'trot'|'prowl'|'trudge'|'bound'|'scramble';

export interface WildlifeMovementProfile {
  id:string;
  mode:WildlifeMovementMode;
  gait:WildlifeGait;
  speedMultiplier:number;
  energyMultiplier:number;
  fastActionMultiplier:number;
  /** Fractions of max speed gained per second while accelerating. */
  accelerationRate:number;
  /** Fractions of max speed lost per second while braking/turning. */
  decelerationRate:number;
  /** Maximum deterministic yaw change in radians per second. */
  turnRate:number;
  /** Fine-path waypoint acceptance radius in world units. */
  arrivalRadius:number;
}

export type WildlifeOrganismForm='wild'|'domesticated'|'monster';

export interface WildlifeFormProfile {
  id:string;
  kind:WildlifeOrganismForm;
  /** Scales the deterministic coarse settlement carrying-capacity penalty. */
  settlementSensitivity:number;
  /** Scales how strongly coarse habitat suitability penalizes danger. */
  dangerSensitivity:number;
}

export interface WildlifeLifeHistoryProfile {
  adultAge:number;
  maxAge:number;
  gestationDays:number;
  birthCooldown:number;
  litterMin:number;
  litterMax:number;
}

export interface WildlifeFineProfile {
  speed:number;
  size:number;
  fertility:number;
  wariness:number;
  maxFine:number;
  maxInitialAge:number;
}

export interface WildlifeMorphologyProfile {
  body:number;
  accent:number;
  bodyX:number;
  bodyY:number;
  bodyZ:number;
  headSize:number;
  legHeight:number;
  features:readonly WildlifeMorphologyFeature[];
  featureColor?:number;
  tailLength?:number;
}

export interface WildlifeSpeciesProfile {
  /** Optional reusable archetype definition used to compose this species profile. */
  archetypeId?:string;
  organismFamily:WildlifeOrganismFamily;
  movement:WildlifeMovementProfile;
  capabilities:readonly WildlifeAction[];
  form:WildlifeFormProfile;
  trophicRole:WildlifeTrophicRole;
  biomeAffinity:Record<ChunkBiome,number>;
  seasonalBiomeAffinity:Record<WorldSeason,Record<ChunkBiome,number>>;
  niche:Record<WildlifeNicheAxis,number>;
  plantForageWeights:Record<'grass'|'shrub'|'fruit'|'crop',number>;
  plantConsumptionWeights:Record<'grass'|'shrub'|'fruit'|'crop',number>;
  baseCarryingCapacity:number;
  growthRate:number;
  herbivoryRate:number;
  predationRate:number;
  huntEnergyCost:number;
  rainMortality:number;
  feedingAction:Extract<WildlifeAction,'graze'|'forage'>;
  forageTags:readonly string[];
  fine:WildlifeFineProfile;
  morphology:WildlifeMorphologyProfile;
  lifeHistory:WildlifeLifeHistoryProfile;
  prey:Partial<Record<WildlifeSpecies,{preference:number;damage:number;hungerRelief:number}>>;
}

const zeroPlants:Record<'grass'|'shrub'|'fruit'|'crop',number>={grass:0,shrub:0,fruit:0,crop:0};
const seasonal=(spring:Record<ChunkBiome,number>,summer:Record<ChunkBiome,number>,autumn:Record<ChunkBiome,number>,winter:Record<ChunkBiome,number>)=>({spring,summer,autumn,winter});

export const WILDLIFE_SPECIES:readonly WildlifeSpecies[]=['rabbit','deer','boar','goat','fox','wolf','badger','lynx','bison','raccoon','sheep','warg'];

export const WILDLIFE_SPECIES_PROFILES:Record<WildlifeSpecies,WildlifeSpeciesProfile>={
  rabbit:{
    organismFamily:'lagomorph',movement:WILDLIFE_MOVEMENT_ARCHETYPES.generalist,capabilities:WILDLIFE_CAPABILITY_ARCHETYPES.grazer.actions,form:WILDLIFE_FORM_ARCHETYPES.wild,
    trophicRole:'herbivore',
    biomeAffinity:{plains:1,forest:.82,hills:.65,wetlands:.72,dryland:.35},
    seasonalBiomeAffinity:seasonal(
      {plains:1.10,forest:1.00,hills:.92,wetlands:1.04,dryland:.76},
      {plains:.98,forest:1.02,hills:.92,wetlands:1.08,dryland:.72},
      {plains:1.04,forest:1.06,hills:.96,wetlands:.94,dryland:.78},
      {plains:.88,forest:1.02,hills:.90,wetlands:.82,dryland:.68}
    ),
    niche:{grass:.58,shrub:.30,fruit:0,crop:.12,prey:0,space:.15},
    plantForageWeights:{grass:.58,shrub:.30,fruit:0,crop:.12},
    plantConsumptionWeights:{grass:.72,shrub:.154,fruit:0,crop:0},
    baseCarryingCapacity:36,growthRate:.010,herbivoryRate:.008,predationRate:0,huntEnergyCost:0,rainMortality:.0025,
    feedingAction:'graze',forageTags:['nature','food','grass'],
    fine:{speed:2.4,size:.55,fertility:.9,wariness:.88,maxFine:3,maxInitialAge:500},
    morphology:{body:0xb8a48d,accent:0xe4d4c1,bodyX:1.15,bodyY:.65,bodyZ:.55,headSize:.48,legHeight:.5,features:['long_ears']},
    lifeHistory:{adultAge:90,maxAge:2200,gestationDays:5,birthCooldown:8,litterMin:1,litterMax:3},
    prey:{}
  },
  deer:{
    organismFamily:'cervid',movement:WILDLIFE_MOVEMENT_ARCHETYPES.cursorial,capabilities:WILDLIFE_CAPABILITY_ARCHETYPES.grazer.actions,form:WILDLIFE_FORM_ARCHETYPES.wild,
    trophicRole:'herbivore',
    biomeAffinity:{plains:.72,forest:1,hills:.82,wetlands:.55,dryland:.28},
    seasonalBiomeAffinity:seasonal(
      {plains:1.02,forest:1.04,hills:1.00,wetlands:.88,dryland:.70},
      {plains:.92,forest:.98,hills:1.12,wetlands:.84,dryland:.66},
      {plains:.90,forest:1.14,hills:.98,wetlands:.80,dryland:.68},
      {plains:.84,forest:1.10,hills:.92,wetlands:.72,dryland:.64}
    ),
    niche:{grass:.38,shrub:.38,fruit:.24,crop:0,prey:0,space:.15},
    plantForageWeights:{grass:.38,shrub:.38,fruit:.24,crop:0},
    plantConsumptionWeights:{grass:.40,shrub:.38,fruit:.22,crop:0},
    baseCarryingCapacity:16,growthRate:.0046,herbivoryRate:.018,predationRate:0,huntEnergyCost:0,rainMortality:0,
    feedingAction:'graze',forageTags:['nature','food','grass'],
    fine:{speed:2.8,size:1.15,fertility:.48,wariness:.82,maxFine:2,maxInitialAge:3200},
    morphology:{body:0x9a6945,accent:0xd2b28f,bodyX:1.15,bodyY:.65,bodyZ:.55,headSize:.48,legHeight:.5,features:['antlers'],featureColor:0x5b4331},
    lifeHistory:{adultAge:300,maxAge:5200,gestationDays:18,birthCooldown:32,litterMin:1,litterMax:1},
    prey:{}
  },
  boar:{
    organismFamily:'suiform',movement:WILDLIFE_MOVEMENT_ARCHETYPES.sturdy,capabilities:WILDLIFE_CAPABILITY_ARCHETYPES.forager.actions,form:WILDLIFE_FORM_ARCHETYPES.wild,
    trophicRole:'herbivore',
    biomeAffinity:{plains:.68,forest:1,hills:.62,wetlands:.84,dryland:.25},
    seasonalBiomeAffinity:seasonal(
      {plains:.94,forest:1.08,hills:.90,wetlands:1.04,dryland:.66},
      {plains:.88,forest:1.02,hills:.86,wetlands:1.14,dryland:.60},
      {plains:.90,forest:1.16,hills:.92,wetlands:1.00,dryland:.64},
      {plains:.80,forest:1.10,hills:.86,wetlands:.88,dryland:.58}
    ),
    niche:{grass:0,shrub:.28,fruit:.34,crop:.38,prey:0,space:.15},
    plantForageWeights:{grass:0,shrub:.28,fruit:.34,crop:.38},
    plantConsumptionWeights:{grass:0,shrub:.25,fruit:.30,crop:.45},
    baseCarryingCapacity:12,growthRate:.0050,herbivoryRate:.020,predationRate:0,huntEnergyCost:0,rainMortality:0,
    feedingAction:'forage',forageTags:['forage','food','farm'],
    fine:{speed:1.9,size:1.0,fertility:.55,wariness:.58,maxFine:2,maxInitialAge:3000},
    morphology:{body:0x5d4a3c,accent:0x796354,bodyX:1.2,bodyY:.7,bodyZ:.6,headSize:.50,legHeight:.45,features:[]},
    lifeHistory:{adultAge:260,maxAge:4300,gestationDays:12,birthCooldown:24,litterMin:1,litterMax:2},
    prey:{}
  },
  goat:{
    organismFamily:'caprine',movement:WILDLIFE_MOVEMENT_ARCHETYPES.cursorial,capabilities:WILDLIFE_CAPABILITY_ARCHETYPES.grazer.actions,form:WILDLIFE_FORM_ARCHETYPES.wild,
    trophicRole:'herbivore',
    biomeAffinity:{plains:.62,forest:.52,hills:1,wetlands:.30,dryland:.76},
    seasonalBiomeAffinity:seasonal(
      {plains:.96,forest:.78,hills:1.10,wetlands:.62,dryland:.96},
      {plains:.82,forest:.72,hills:1.08,wetlands:.52,dryland:1.04},
      {plains:.90,forest:.76,hills:1.12,wetlands:.56,dryland:.98},
      {plains:.78,forest:.70,hills:1.02,wetlands:.46,dryland:.88}
    ),
    niche:{grass:.48,shrub:.42,fruit:.06,crop:.04,prey:0,space:.18},
    plantForageWeights:{grass:.48,shrub:.42,fruit:.06,crop:.04},
    plantConsumptionWeights:{grass:.52,shrub:.42,fruit:.06,crop:0},
    baseCarryingCapacity:14,growthRate:.0058,herbivoryRate:.016,predationRate:0,huntEnergyCost:0,rainMortality:0,
    feedingAction:'graze',forageTags:['nature','food','grass'],
    fine:{speed:2.5,size:.82,fertility:.62,wariness:.72,maxFine:2,maxInitialAge:2600},
    morphology:{body:0xc2b8a0,accent:0xe4dcc8,bodyX:1.15,bodyY:.65,bodyZ:.55,headSize:.48,legHeight:.5,features:['horns'],featureColor:0x75684f},
    lifeHistory:{adultAge:220,maxAge:3900,gestationDays:14,birthCooldown:26,litterMin:1,litterMax:2},
    prey:{}
  },
  fox:{
    organismFamily:'canid',movement:WILDLIFE_MOVEMENT_ARCHETYPES.cursorial,capabilities:WILDLIFE_CAPABILITY_ARCHETYPES.predatorForager.actions,form:WILDLIFE_FORM_ARCHETYPES.wild,
    trophicRole:'predator',
    biomeAffinity:{plains:.9,forest:.92,hills:.78,wetlands:.56,dryland:.48},
    seasonalBiomeAffinity:seasonal(
      {plains:1.05,forest:1.03,hills:.96,wetlands:.88,dryland:.76},
      {plains:1.02,forest:1.00,hills:.98,wetlands:.90,dryland:.74},
      {plains:1.00,forest:1.08,hills:1.00,wetlands:.84,dryland:.76},
      {plains:.94,forest:1.06,hills:.98,wetlands:.78,dryland:.72}
    ),
    niche:{grass:0,shrub:0,fruit:0,crop:0,prey:.75,space:.25},
    plantForageWeights:zeroPlants,plantConsumptionWeights:zeroPlants,
    baseCarryingCapacity:7,growthRate:.0032,herbivoryRate:0,predationRate:.015,huntEnergyCost:8,rainMortality:0,
    feedingAction:'forage',forageTags:['forage','food'],
    fine:{speed:2.7,size:.7,fertility:.42,wariness:.76,maxFine:1,maxInitialAge:1800},
    morphology:{body:0xc86f35,accent:0xf0d0a5,bodyX:1.15,bodyY:.65,bodyZ:.55,headSize:.48,legHeight:.5,features:['tail'],tailLength:.75},
    lifeHistory:{adultAge:240,maxAge:1900,gestationDays:8,birthCooldown:20,litterMin:1,litterMax:2},
    prey:{rabbit:{preference:1,damage:100,hungerRelief:48},deer:{preference:.22,damage:45,hungerRelief:30}}
  },
  wolf:{
    organismFamily:'canid',movement:WILDLIFE_MOVEMENT_ARCHETYPES.cursorial,capabilities:WILDLIFE_CAPABILITY_ARCHETYPES.predatorForager.actions,form:WILDLIFE_FORM_ARCHETYPES.wild,
    trophicRole:'predator',
    biomeAffinity:{plains:.68,forest:1,hills:.94,wetlands:.46,dryland:.44},
    seasonalBiomeAffinity:seasonal(
      {plains:.90,forest:1.08,hills:1.02,wetlands:.68,dryland:.66},
      {plains:.82,forest:1.02,hills:1.08,wetlands:.62,dryland:.60},
      {plains:.88,forest:1.14,hills:1.06,wetlands:.64,dryland:.62},
      {plains:.92,forest:1.16,hills:1.08,wetlands:.58,dryland:.64}
    ),
    niche:{grass:0,shrub:0,fruit:0,crop:0,prey:.82,space:.36},
    plantForageWeights:zeroPlants,plantConsumptionWeights:zeroPlants,
    baseCarryingCapacity:5,growthRate:.0026,herbivoryRate:0,predationRate:.021,huntEnergyCost:10,rainMortality:0,
    feedingAction:'forage',forageTags:['forage','food'],
    fine:{speed:3.0,size:1.0,fertility:.36,wariness:.70,maxFine:1,maxInitialAge:2200},
    morphology:{body:0x696d72,accent:0xb0b3b7,bodyX:1.18,bodyY:.68,bodyZ:.58,headSize:.49,legHeight:.52,features:['tail'],tailLength:.82},
    lifeHistory:{adultAge:300,maxAge:2600,gestationDays:10,birthCooldown:24,litterMin:1,litterMax:2},
    prey:{
      rabbit:{preference:.34,damage:100,hungerRelief:34},
      deer:{preference:.72,damage:78,hungerRelief:52},
      boar:{preference:.48,damage:58,hungerRelief:44},
      goat:{preference:.68,damage:86,hungerRelief:50},
      fox:{preference:.08,damage:72,hungerRelief:24},
      badger:{preference:.14,damage:65,hungerRelief:20},
      lynx:{preference:.12,damage:68,hungerRelief:22},
      raccoon:{preference:.10,damage:72,hungerRelief:22},
      sheep:{preference:.82,damage:92,hungerRelief:48}
    }
  },
  badger:{
    organismFamily:'mustelid',movement:WILDLIFE_MOVEMENT_ARCHETYPES.sturdy,capabilities:WILDLIFE_CAPABILITY_ARCHETYPES.omnivoreForager.actions,form:WILDLIFE_FORM_ARCHETYPES.wild,
    trophicRole:'omnivore',
    biomeAffinity:{plains:.62,forest:.92,hills:.84,wetlands:.70,dryland:.38},
    seasonalBiomeAffinity:seasonal(
      {plains:.78,forest:1.06,hills:.96,wetlands:.92,dryland:.62},
      {plains:.72,forest:1.00,hills:.92,wetlands:.88,dryland:.58},
      {plains:.78,forest:1.08,hills:.98,wetlands:.82,dryland:.62},
      {plains:.70,forest:.98,hills:.90,wetlands:.74,dryland:.56}
    ),
    niche:{grass:.05,shrub:.18,fruit:.22,crop:.15,prey:.28,space:.22},
    plantForageWeights:{grass:.05,shrub:.25,fruit:.42,crop:.28},
    plantConsumptionWeights:{grass:.02,shrub:.08,fruit:.12,crop:.08},
    baseCarryingCapacity:8,growthRate:.0038,herbivoryRate:.007,predationRate:.010,huntEnergyCost:7,rainMortality:0,
    feedingAction:'forage',forageTags:['forage','food','nature','farm'],
    fine:{speed:2.2,size:.78,fertility:.38,wariness:.68,maxFine:1,maxInitialAge:2100},
    morphology:{body:0x454944,accent:0xd8d5c8,bodyX:1.28,bodyY:.56,bodyZ:.62,headSize:.44,legHeight:.38,features:['tail','dorsal_stripe'],featureColor:0xf0ead8,tailLength:.42},
    lifeHistory:{adultAge:280,maxAge:3600,gestationDays:11,birthCooldown:24,litterMin:1,litterMax:2},
    prey:{rabbit:{preference:.55,damage:90,hungerRelief:36}}
  },
  lynx:composeWildlifeSpeciesProfile({
    id:'temperate_felid_mesopredator',
    habitat:WILDLIFE_HABITAT_ARCHETYPES.temperateForestHills,
    ecology:WILDLIFE_ECOLOGY_ARCHETYPES.mediumAmbushPredator,
    body:WILDLIFE_BODY_ARCHETYPES.mediumFelid,
    movement:WILDLIFE_MOVEMENT_ARCHETYPES.ambush,
    capabilities:WILDLIFE_CAPABILITY_ARCHETYPES.predatorForager,
    form:WILDLIFE_FORM_ARCHETYPES.wild,
    life:WILDLIFE_LIFE_ARCHETYPES.mediumSolitaryPredator,
    prey:{
      rabbit:{preference:.88,damage:100,hungerRelief:44},
      goat:{preference:.32,damage:58,hungerRelief:36},
      deer:{preference:.18,damage:46,hungerRelief:30},
      raccoon:{preference:.16,damage:70,hungerRelief:24}
    }
  }),
  bison:composeWildlifeSpeciesProfile({
    id:'open_plains_large_grazer',
    habitat:WILDLIFE_HABITAT_ARCHETYPES.openPlains,
    ecology:WILDLIFE_ECOLOGY_ARCHETYPES.largeGrazer,
    body:WILDLIFE_BODY_ARCHETYPES.largeBovid,
    movement:WILDLIFE_MOVEMENT_ARCHETYPES.heavyGrazer,
    capabilities:WILDLIFE_CAPABILITY_ARCHETYPES.grazer,
    form:WILDLIFE_FORM_ARCHETYPES.wild,
    life:WILDLIFE_LIFE_ARCHETYPES.largeHerdHerbivore
  }),
  raccoon:composeWildlifeSpeciesProfile({
    id:'forest_wetland_small_omnivore',
    habitat:WILDLIFE_HABITAT_ARCHETYPES.forestWetlandEdge,
    ecology:WILDLIFE_ECOLOGY_ARCHETYPES.smallOpportunisticOmnivore,
    body:WILDLIFE_BODY_ARCHETYPES.smallMaskedForager,
    movement:WILDLIFE_MOVEMENT_ARCHETYPES.dexterousForager,
    capabilities:WILDLIFE_CAPABILITY_ARCHETYPES.omnivoreForager,
    form:WILDLIFE_FORM_ARCHETYPES.wild,
    life:WILDLIFE_LIFE_ARCHETYPES.smallGeneralistOmnivore,
    prey:{rabbit:{preference:.16,damage:44,hungerRelief:20}}
  }),
  sheep:composeWildlifeSpeciesProfile({
    id:'domesticated_open_plains_grazer',
    habitat:WILDLIFE_HABITAT_ARCHETYPES.openPlains,
    ecology:WILDLIFE_ECOLOGY_ARCHETYPES.largeGrazer,
    body:WILDLIFE_BODY_ARCHETYPES.mediumWoollyBovid,
    movement:WILDLIFE_MOVEMENT_ARCHETYPES.generalist,
    capabilities:WILDLIFE_CAPABILITY_ARCHETYPES.grazer,
    form:WILDLIFE_FORM_ARCHETYPES.domesticated,
    life:WILDLIFE_LIFE_ARCHETYPES.largeHerdHerbivore
  }),
  warg:composeWildlifeSpeciesProfile({
    id:'monster_temperate_large_canid',
    habitat:WILDLIFE_HABITAT_ARCHETYPES.temperateForestHills,
    ecology:WILDLIFE_ECOLOGY_ARCHETYPES.mediumAmbushPredator,
    body:WILDLIFE_BODY_ARCHETYPES.largeCanid,
    movement:WILDLIFE_MOVEMENT_ARCHETYPES.cursorial,
    capabilities:WILDLIFE_CAPABILITY_ARCHETYPES.predatorForager,
    form:WILDLIFE_FORM_ARCHETYPES.monster,
    life:WILDLIFE_LIFE_ARCHETYPES.mediumSolitaryPredator,
    prey:{
      sheep:{preference:.92,damage:100,hungerRelief:52},
      deer:{preference:.62,damage:88,hungerRelief:48},
      goat:{preference:.54,damage:90,hungerRelief:46},
      rabbit:{preference:.28,damage:100,hungerRelief:30},
      raccoon:{preference:.14,damage:82,hungerRelief:24},
      bison:{preference:.12,damage:54,hungerRelief:42}
    }
  })
};

export const WILDLIFE_HERBIVORES:readonly WildlifeSpecies[]=WILDLIFE_SPECIES.filter(species=>WILDLIFE_SPECIES_PROFILES[species].trophicRole==='herbivore');
export const WILDLIFE_PREDATORS:readonly WildlifeSpecies[]=WILDLIFE_SPECIES.filter(species=>Object.keys(WILDLIFE_SPECIES_PROFILES[species].prey).length>0);

export function wildlifeSpeciesProfile(species:WildlifeSpecies){
  return WILDLIFE_SPECIES_PROFILES[species];
}

export function wildlifePreySpecies(species:WildlifeSpecies){
  return Object.keys(WILDLIFE_SPECIES_PROFILES[species].prey) as WildlifeSpecies[];
}

export function isWildlifePredator(species:WildlifeSpecies){
  return wildlifePreySpecies(species).length>0;
}

export function canWildlifePredate(predator:WildlifeSpecies,prey:WildlifeSpecies){
  return Boolean(WILDLIFE_SPECIES_PROFILES[predator].prey[prey]);
}

export function wildlifePredationPreference(predator:WildlifeSpecies,prey:WildlifeSpecies){
  return WILDLIFE_SPECIES_PROFILES[predator].prey[prey]?.preference||0;
}

export function wildlifePredationDamage(predator:WildlifeSpecies,prey:WildlifeSpecies){
  return WILDLIFE_SPECIES_PROFILES[predator].prey[prey]?.damage||0;
}

export function wildlifeHungerRelief(predator:WildlifeSpecies,prey:WildlifeSpecies){
  return WILDLIFE_SPECIES_PROFILES[predator].prey[prey]?.hungerRelief||0;
}


export function wildlifeResourceSupportsAction(species:WildlifeSpecies,action:WildlifeAction,resource:{tags:readonly string[];kind?:WorldObjectState['kind']}){
  if(resource.kind==='dropped_item')return false;
  const water=resource.tags.includes('water')||resource.kind==='well'||resource.kind==='water_patch';
  if(action==='drink')return water;
  if((action!=='graze'&&action!=='forage')||water)return false;
  const plant=resource.tags.some(tag=>['food','forage','grass','fruit','crop','apple','flower'].includes(tag))
    ||resource.kind==='bush'||resource.kind==='flower';
  return plant&&(resource.tags.some(tag=>wildlifeSpeciesProfile(species).forageTags.includes(tag))
    ||resource.kind==='bush'||resource.kind==='flower'||resource.tags.includes('apple')||resource.tags.includes('flower'));
}
