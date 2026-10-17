import type {
  ChunkBiome, CoarseChunkState, CoarseWildlifePopulation, PlantBiomassState, WildlifeCompetitionPair, WildlifeDiseasePair, WildlifePredatorPressurePair, WildlifeSpecies, WorldSeason
} from '../types';
import { CoarseChunkSpatialIndex, type CoarseChunkCoordinateLookup } from './coarseSpatialIndex';
import { canWildlifePredate, isWildlifePredator, WILDLIFE_HERBIVORES, WILDLIFE_PREDATORS, WILDLIFE_SPECIES, wildlifePredationPreference, wildlifePreySpecies, wildlifeSpeciesProfile } from './wildlifeSpecies.js';

export interface WildlifeMigration {
  species: WildlifeSpecies;
  fromChunkId: string;
  toChunkId: string;
  amount: number;
}

const SPECIES=[...WILDLIFE_SPECIES];
const clamp=(v:number,min=0,max=100)=>Math.max(min,Math.min(max,v));
const round=(v:number)=>Math.round(v*1000)/1000;
const plantTotal=(p:{grass:number;shrub:number;fruit:number;crop:number})=>p.grass+p.shrub+p.fruit+p.crop;

function smooth(previous:number,next:number,weight=.08){
  return round(previous*(1-weight)+Math.max(0,next)*weight);
}

const NICHE_AXES=['grass','shrub','fruit','crop','prey','space'] as const;


export function wildlifeDiseaseContactCoefficient(from:WildlifeSpecies,to:WildlifeSpecies){
  if(from===to)return 1;
  if(WILDLIFE_HERBIVORES.includes(from)&&WILDLIFE_HERBIVORES.includes(to))return .28;
  if(canWildlifePredate(from,to))return .42;
  if(canWildlifePredate(to,from))return .24;
  if(isWildlifePredator(from)&&isWildlifePredator(to))return .20;
  return .16;
}

export function computeWildlifeDiseasePressure(
  chunk:CoarseChunkState,
  populations:CoarseWildlifePopulation[],
  weather='clear'
){
  const environmentalPressure=clamp(
    (chunk.biome==='wetlands'?18:0)+
    (weather==='rain'?12:weather==='cloudy'?4:0)+
    (chunk.water>88?4:0)+
    (chunk.ecology<28?6:0)
  );
  const speciesRecord=()=>Object.fromEntries(SPECIES.map(species=>[species,0])) as Record<WildlifeSpecies,number>;
  const localContactPressure=speciesRecord();
  const crossSpeciesPressure=speciesRecord();
  const importedPressure=speciesRecord();
  const speciesPressure=speciesRecord();
  const pairs:WildlifeDiseasePair[]=[];
  let strongestPair:WildlifeDiseasePair|undefined;

  for(const target of populations){
    const density=target.carryingCapacity>0?Math.min(2.5,target.count/target.carryingCapacity):2;
    const ownLoad=clamp(target.diseaseLoad||0);
    localContactPressure[target.species]=round(clamp(ownLoad*density*.62));
    importedPressure[target.species]=round(clamp(target.importedDiseasePressure||0));

    let cross=0;
    for(const source of populations){
      if(source.species===target.species)continue;
      const sourceDensity=source.carryingCapacity>0?Math.min(2.5,source.count/source.carryingCapacity):2;
      const pairPressure=round(clamp(
        (source.diseaseLoad||0)*sourceDensity*wildlifeDiseaseContactCoefficient(source.species,target.species)*.55
      ));
      cross+=pairPressure;
      const pair={fromSpecies:source.species,toSpecies:target.species,pressure:pairPressure};
      pairs.push(pair);
      if(pairPressure>0&&(!strongestPair||pairPressure>strongestPair.pressure))strongestPair=pair;
    }
    crossSpeciesPressure[target.species]=round(clamp(cross));
    speciesPressure[target.species]=round(clamp(
      environmentalPressure*.34+
      localContactPressure[target.species]*.52+
      crossSpeciesPressure[target.species]*.38+
      importedPressure[target.species]*.44
    ));
  }

  const meanPressure=round(SPECIES.reduce((sum,species)=>sum+speciesPressure[species],0)/SPECIES.length);
  pairs.sort((a,b)=>b.pressure-a.pressure||a.fromSpecies.localeCompare(b.fromSpecies)||a.toSpecies.localeCompare(b.toSpecies));
  chunk.wildlifeDisease={
    environmentalPressure:round(environmentalPressure),
    speciesPressure,localContactPressure,crossSpeciesPressure,importedPressure,meanPressure,pairs,strongestPair
  };
  return chunk.wildlifeDisease;
}

function hash(text:string){
  let h=2166136261;
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}
  return (h>>>0)/4294967295;
}

export function seasonForDay(day:number):WorldSeason {
  const index=Math.floor(Math.max(0,day-1)/30)%4;
  return (['spring','summer','autumn','winter'] as WorldSeason[])[index]!;
}

export function ensurePlantBiomass(chunk:CoarseChunkState):PlantBiomassState {
  if(chunk.plants){
    for(const key of ['grass','shrub','fruit','crop'] as const)chunk.plants[key]=clamp(Number(chunk.plants[key])||0);
    return chunk.plants;
  }
  const biome=chunk.biome;
  const jitter=(salt:string)=>.82+hash(`${chunk.id}:${salt}`)*.36;
  const base:Record<ChunkBiome,PlantBiomassState>={
    plains:{grass:82,shrub:44,fruit:28,crop:38},
    forest:{grass:48,shrub:78,fruit:64,crop:18},
    hills:{grass:52,shrub:58,fruit:34,crop:20},
    wetlands:{grass:68,shrub:74,fruit:42,crop:30},
    dryland:{grass:26,shrub:31,fruit:14,crop:16}
  };
  const source=base[biome];
  const settlementBoost=chunk.settlementLevel*10;
  chunk.plants={
    grass:clamp(source.grass*jitter('grass')*chunk.ecology/75),
    shrub:clamp(source.shrub*jitter('shrub')*chunk.ecology/75),
    fruit:clamp(source.fruit*jitter('fruit')*chunk.ecology/75),
    crop:clamp((source.crop+settlementBoost)*jitter('crop')*(chunk.food/65))
  };
  return chunk.plants;
}

export function simulatePlantBiomass(chunk:CoarseChunkState,seconds:number,weather:string,day:number){
  const plants=ensurePlantBiomass(chunk);
  const dt=Math.min(30,Math.max(0,seconds));
  const season=seasonForDay(day);
  const seasonGrowth:Record<WorldSeason,number>={spring:1.35,summer:1.05,autumn:.72,winter:.24};
  const rain=weather==='rain'?1.28:weather==='cloudy'?1.04:.92;
  const water=clamp(chunk.water/65,.18,1.25);
  const ecology=clamp(chunk.ecology/70,.25,1.3);
  const growth=.045*seasonGrowth[season]*rain*water*ecology*dt;
  const targets:PlantBiomassState={
    grass:chunk.biome==='plains'?92:chunk.biome==='dryland'?38:70,
    shrub:chunk.biome==='forest'||chunk.biome==='wetlands'?88:55,
    fruit:chunk.biome==='forest'?78:chunk.biome==='dryland'?24:48,
    crop:chunk.settlementLevel>0?72:24
  };
  for(const key of ['grass','shrub','fruit','crop'] as const){
    const cultivation=key==='crop'?1+chunk.settlementLevel*.14:1;
    plants[key]=clamp(plants[key]+Math.max(0,targets[key]-plants[key])*growth*.012*cultivation);
  }
  if(season==='winter'){
    plants.grass=clamp(plants.grass-.012*dt);
    plants.fruit=clamp(plants.fruit-.02*dt);
  }
  if(chunk.ecologyPolicy==='recover'){
    plants.grass=clamp(plants.grass+.015*dt);plants.shrub=clamp(plants.shrub+.012*dt);
  }else if(chunk.ecologyPolicy==='harvest'){
    plants.crop=clamp(plants.crop+.012*dt);plants.shrub=clamp(plants.shrub-.008*dt);
  }
  chunk.food=clamp(chunk.food+(plants.crop*.0008+plants.fruit*.00035-.025)*dt);
}

function plantFoodIndex(chunk:CoarseChunkState,species:WildlifeSpecies){
  const p=ensurePlantBiomass(chunk);
  const profile=wildlifeSpeciesProfile(species);
  const weights=profile.plantForageWeights;
  const plantForage=p.grass*weights.grass+p.shrub*weights.shrub+p.fruit*weights.fruit+p.crop*weights.crop;
  const prey=wildlifePreySpecies(species);
  if(!prey.length)return plantForage;
  const preyDensity=(chunk.wildlife||[])
    .filter(pop=>prey.includes(pop.species))
    .reduce((sum,pop)=>sum+Math.min(1.5,pop.count/Math.max(.001,pop.carryingCapacity||1)),0);
  const preyForage=clamp(chunk.ecology*.30+chunk.food*.20+preyDensity*24);
  const plantWeight=weights.grass+weights.shrub+weights.fruit+weights.crop;
  return plantWeight>0?clamp(plantForage*.45+preyForage*.55):preyForage;
}

export function seasonalHabitatSuitability(chunk:CoarseChunkState,species:WildlifeSpecies,day:number){
  const season=seasonForDay(day);
  const profile=wildlifeSpeciesProfile(species);
  const seasonalAffinity=profile.seasonalBiomeAffinity[season][chunk.biome];
  const forage=plantFoodIndex(chunk,species);
  const safety=clamp(100-chunk.danger*profile.form.dangerSensitivity);
  const base=chunk.ecology*.30+forage*.32+chunk.water*.20+safety*.18;
  return round(clamp(base*seasonalAffinity,0,100));
}

function fundamentalCapacity(chunk:CoarseChunkState,species:WildlifeSpecies){
  const profile=wildlifeSpeciesProfile(species);
  const affinity=profile.biomeAffinity[chunk.biome];
  const forage=plantFoodIndex(chunk,species);
  const safety=clamp(100-chunk.danger*profile.form.dangerSensitivity);
  const habitat=(chunk.ecology*.38+forage*.32+chunk.water*.20+safety*.10)/100;
  const settlementPenalty=Math.max(.3,1-chunk.settlementLevel*.16*profile.form.settlementSensitivity);
  return Math.max(0,round(profile.baseCarryingCapacity*affinity*habitat*settlementPenalty));
}

export function computeWildlifePredatorPressure(
  chunk:CoarseChunkState,
  populations:CoarseWildlifePopulation[]
) {
  const speciesPressure=Object.fromEntries(SPECIES.map(species=>[species,0])) as Record<WildlifeSpecies,number>;
  const pairs:WildlifePredatorPressurePair[]=[];
  let strongestPair:NonNullable<CoarseChunkState['wildlifePredatorPressure']>['strongestPair'];

  for(const preySpecies of SPECIES){
    let aggregate=0;
    for(const predatorSpecies of SPECIES){
      const preference=wildlifePredationPreference(predatorSpecies,preySpecies);
      if(preference<=0)continue;
      const predator=populations.find(entry=>entry.species===predatorSpecies);
      if(!predator||predator.count<=0)continue;
      const predatorDensity=predator.carryingCapacity>0
        ?Math.min(2.5,Math.max(0,predator.count/predator.carryingCapacity))
        :0;
      const pairPressure=round(clamp(preference*predatorDensity*70,0,100));
      if(pairPressure<=0)continue;
      aggregate+=preference*predatorDensity;
      const pair={predatorSpecies,preySpecies,pressure:pairPressure};
      pairs.push(pair);
      if(!strongestPair||pairPressure>strongestPair.pressure)strongestPair=pair;
    }
    const pressure=round(clamp((1-Math.exp(-aggregate*.9))*100,0,100));
    speciesPressure[preySpecies]=pressure;
    const prey=populations.find(entry=>entry.species===preySpecies);
    if(prey)prey.predatorPressure=pressure;
  }

  pairs.sort((a,b)=>b.pressure-a.pressure||a.predatorSpecies.localeCompare(b.predatorSpecies)||a.preySpecies.localeCompare(b.preySpecies));
  const meanPressure=round(SPECIES.reduce((sum,species)=>sum+speciesPressure[species],0)/SPECIES.length);
  chunk.wildlifePredatorPressure={speciesPressure,meanPressure,pairs,strongestPair};
  return chunk.wildlifePredatorPressure;
}

export function computeWildlifeNicheCompetition(chunk:CoarseChunkState,populations:CoarseWildlifePopulation[]) {
  const fundamental=new Map<WildlifeSpecies,number>();
  const density=new Map<WildlifeSpecies,number>();
  for(const species of SPECIES){
    const k=Math.max(.001,fundamentalCapacity(chunk,species));
    const pop=populations.find(entry=>entry.species===species);
    fundamental.set(species,k);
    density.set(species,Math.min(2.5,Math.max(0,(pop?.count||0)/k)));
  }

  const speciesPressure=Object.fromEntries(SPECIES.map(species=>[species,0])) as Record<WildlifeSpecies,number>;
  const niches=SPECIES.map(species=>{
    const niche=wildlifeSpeciesProfile(species).niche;
    const total=NICHE_AXES.reduce((sum,key)=>sum+niche[key],0);
    return NICHE_AXES.map(key=>niche[key]/total);
  });
  const pairs:WildlifeCompetitionPair[]=[];
  let strongestPair:NonNullable<CoarseChunkState['nicheCompetition']>['strongestPair'];
  for(let i=0;i<SPECIES.length;i++){
    for(let j=i+1;j<SPECIES.length;j++){
      const a=SPECIES[i]!,b=SPECIES[j]!;
      const na=niches[i]!,nb=niches[j]!;
      let shared=0;
      for(let axis=0;axis<NICHE_AXES.length;axis++)shared+=Math.min(na[axis]!,nb[axis]!);
      const overlap=clamp(shared,0,1);
      if(overlap<=0)continue;
      const da=density.get(a)||0,db=density.get(b)||0;
      const pairPressure=round(clamp(overlap*((da+db)/2)*100,0,100));
      const pair={speciesA:a,speciesB:b,nicheOverlap:round(overlap),pressure:pairPressure};
      pairs.push(pair);
      if(pairPressure>0&&(!strongestPair||pairPressure>strongestPair.pressure))strongestPair=pair;
      speciesPressure[a]+=overlap*db;
      speciesPressure[b]+=overlap*da;
    }
  }

  for(const species of SPECIES){
    const normalized=clamp((1-Math.exp(-speciesPressure[species]*.58))*100,0,100);
    speciesPressure[species]=round(normalized);
    const pop=populations.find(entry=>entry.species===species);
    if(!pop)continue;
    const competitionPenalty=Math.min(.32,normalized/100*.32);
    pop.competitionPressure=round(normalized);
    pop.carryingCapacity=round((fundamental.get(species)||0)*(1-competitionPenalty));
  }

  pairs.sort((a,b)=>b.pressure-a.pressure||a.speciesA.localeCompare(b.speciesA)||a.speciesB.localeCompare(b.speciesB));
  const meanPressure=round(SPECIES.reduce((sum,species)=>sum+speciesPressure[species],0)/SPECIES.length);
  chunk.nicheCompetition={speciesPressure,meanPressure,pairs,strongestPair};
  return chunk.nicheCompetition;
}

export function ensureWildlifePopulations(chunk:CoarseChunkState){
  ensurePlantBiomass(chunk);
  const existing=new Map((chunk.wildlife||[]).map(x=>[x.species,x]));
  const seeded:CoarseWildlifePopulation[]=SPECIES.map(species=>{
    const carryingCapacity=fundamentalCapacity(chunk,species);
    const current=existing.get(species);
    if(current){
      current.carryingCapacity=carryingCapacity;
      current.health=clamp(Number.isFinite(current.health)?current.health:75);
      current.count=Math.max(0,current.count);
      current.diseaseLoad=clamp(Number(current.diseaseLoad)||0);
      current.importedDiseasePressure=clamp(Number(current.importedDiseasePressure)||0);
      return current;
    }
    const occupancy=.22+hash(`${chunk.id}:${species}:population`)*.52;
    const count=round(carryingCapacity*occupancy);
    return {
      species,count,carryingCapacity,health:65+hash(`${chunk.id}:${species}:health`)*25,
      diseaseLoad:hash(`${chunk.id}:${species}:disease`)*4,importedDiseasePressure:0
    };
  });
  chunk.wildlife=seeded;
  computeWildlifeNicheCompetition(chunk,seeded);
  computeWildlifePredatorPressure(chunk,seeded);
  return seeded;
}

function consumePlants(chunk:CoarseChunkState,species:WildlifeSpecies,amount:number){
  const p=ensurePlantBiomass(chunk);
  if(amount<=0)return;
  const weights=wildlifeSpeciesProfile(species).plantConsumptionWeights;
  p.grass=clamp(p.grass-amount*weights.grass);
  p.shrub=clamp(p.shrub-amount*weights.shrub);
  p.fruit=clamp(p.fruit-amount*weights.fruit);
  p.crop=clamp(p.crop-amount*weights.crop);
}

export function simulateWildlife(chunk:CoarseChunkState,seconds:number,weather:string,day=1){
  const plantsBefore=plantTotal(ensurePlantBiomass(chunk));
  simulatePlantBiomass(chunk,seconds,weather,day);
  const primaryProduction=Math.max(0,plantTotal(ensurePlantBiomass(chunk))-plantsBefore);
  const populations=ensureWildlifePopulations(chunk);
  const dt=Math.min(30,Math.max(0,seconds));
  let mortalityReturn=0;
  computeWildlifeNicheCompetition(chunk,populations);
  computeWildlifePredatorPressure(chunk,populations);
  const diseasePressure=computeWildlifeDiseasePressure(chunk,populations,weather);

  for(const pop of populations){
    const k=Math.max(.001,pop.carryingCapacity);
    const density=pop.count/k;
    const load=clamp(pop.diseaseLoad||0);
    const targetPressure=diseasePressure.speciesPressure[pop.species]||0;
    const transmission=Math.max(0,targetPressure-load)*.0065*dt;
    const recovery=(.0045+Math.max(0,chunk.ecology-55)*.000025)*dt;
    pop.diseaseLoad=clamp(load+transmission-recovery);
    pop.importedDiseasePressure=clamp((pop.importedDiseasePressure||0)*Math.exp(-dt*.018));

    const rainPenalty=weather==='rain'?wildlifeSpeciesProfile(pop.species).rainMortality:0;
    const droughtPenalty=chunk.water<25?.006:0;
    const humanPressure=chunk.settlementLevel*.0012+Math.max(0,chunk.danger-65)*.00012;
    const diseaseMortality=(pop.diseaseLoad||0)*.000045;
    const growthRate=wildlifeSpeciesProfile(pop.species).growthRate;
    const natural=growthRate*pop.count*(1-density)*dt;
    const losses=(rainPenalty+droughtPenalty+humanPressure+diseaseMortality)*pop.count*dt;
    mortalityReturn+=Math.max(0,losses);
    pop.count=Math.max(0,round(pop.count+natural-losses));

    const forage=plantFoodIndex(chunk,pop.species);
    const habitatHealth=clamp(30+chunk.ecology*.31+forage*.20+chunk.water*.14-chunk.danger*.10-(pop.diseaseLoad||0)*.22-(pop.competitionPressure||0)*.08);
    pop.health=clamp(pop.health+(habitatHealth-pop.health)*Math.min(.10,dt*.003));
  }

  const beforeHerbivory=plantTotal(ensurePlantBiomass(chunk));
  for(const species of SPECIES){
    const profile=wildlifeSpeciesProfile(species);
    if(profile.herbivoryRate<=0)continue;
    const pop=populations.find(entry=>entry.species===species);
    if(pop)consumePlants(chunk,species,pop.count*profile.herbivoryRate*dt);
  }
  const herbivory=Math.max(0,beforeHerbivory-plantTotal(ensurePlantBiomass(chunk)));

  let predation=0;
  for(const predatorSpecies of WILDLIFE_PREDATORS){
    const predator=populations.find(entry=>entry.species===predatorSpecies);
    if(!predator||predator.count<=0)continue;
    const predationRate=wildlifeSpeciesProfile(predatorSpecies).predationRate;
    if(predationRate<=0)continue;
    let predatorKills=0;
    for(const preySpecies of wildlifePreySpecies(predatorSpecies)){
      const prey=populations.find(entry=>entry.species===preySpecies);
      if(!prey||prey.count<=0)continue;
      const preference=wildlifePredationPreference(predatorSpecies,preySpecies);
      const potential=predator.count*predationRate*preference*dt;
      const kill=Math.min(prey.count,potential*Math.min(1,prey.count/Math.max(1,predator.count*2)));
      if(kill<=0)continue;
      prey.count=Math.max(0,round(prey.count-kill));
      predatorKills+=kill;
      predation+=kill;
    }
    predator.health=clamp(predator.health+(predatorKills>0?.07:-.05)*dt);
  }

  const p=ensurePlantBiomass(chunk);
  const plantAverage=(p.grass+p.shrub+p.fruit+p.crop)/4;
  chunk.ecology=clamp(chunk.ecology+(plantAverage-chunk.ecology)*.0008*dt+(chunk.ecologyPolicy==='recover'?.015:0)*dt);

  const flux=chunk.trophicFlux??{primaryProduction:0,herbivory:0,predation:0,mortalityReturn:0};
  flux.primaryProduction=smooth(flux.primaryProduction,primaryProduction);
  flux.herbivory=smooth(flux.herbivory,herbivory);
  flux.predation=smooth(flux.predation,predation);
  flux.mortalityReturn=smooth(flux.mortalityReturn,mortalityReturn+predation*.12);
  chunk.trophicFlux=flux;
  computeWildlifeNicheCompetition(chunk,populations);
  computeWildlifePredatorPressure(chunk,populations);
  computeWildlifeDiseasePressure(chunk,populations,weather);
}

export function planWildlifeMigration(
  chunks:Iterable<CoarseChunkState>,
  materialized:ReadonlySet<string>,
  day=1,
  spatialIndex?:CoarseChunkCoordinateLookup
):WildlifeMigration[]{
  const list=spatialIndex?chunks:[...chunks];
  const neighborLookup=spatialIndex??new CoarseChunkSpatialIndex(list);
  const moves:WildlifeMigration[]=[];
  for(const source of list){
    if(materialized.has(source.id))continue;
    ensureWildlifePopulations(source);
    for(const [dx,dz] of [[1,0],[0,1]] as const){
      const other=neighborLookup.get(source.cx+dx,source.cz+dz);
      if(!other||materialized.has(other.id))continue;
      ensureWildlifePopulations(other);
      for(const species of SPECIES){
        const a=source.wildlife!.find(x=>x.species===species)!;
        const b=other.wildlife!.find(x=>x.species===species)!;
        const densityA=a.carryingCapacity>0?a.count/a.carryingCapacity:2;
        const densityB=b.carryingCapacity>0?b.count/b.carryingCapacity:2;
        const suitabilityA=seasonalHabitatSuitability(source,species,day);
        const suitabilityB=seasonalHabitatSuitability(other,species,day);
        const stressA=densityA+(a.diseaseLoad||0)/100*.35+(100-suitabilityA)/100*.55;
        const stressB=densityB+(b.diseaseLoad||0)/100*.35+(100-suitabilityB)/100*.55;
        const from=stressA>=stressB?source:other;
        const to=from===source?other:source;
        const fp=from.wildlife!.find(x=>x.species===species)!;
        const tp=to.wildlife!.find(x=>x.species===species)!;
        const fd=fp.carryingCapacity>0?fp.count/fp.carryingCapacity:2;
        const td=tp.carryingCapacity>0?tp.count/tp.carryingCapacity:2;
        const fromSuitability=seasonalHabitatSuitability(from,species,day);
        const toSuitability=seasonalHabitatSuitability(to,species,day);
        const diseasePressure=((fp.diseaseLoad||0)-(tp.diseaseLoad||0))/100;
        const seasonalPull=(toSuitability-fromSuitability)/100;
        const pressureDelta=(fd-td)+diseasePressure*.35+seasonalPull*.55;
        const seasonalDriver=seasonalPull>=.08;
        if((pressureDelta<.20&&!seasonalDriver)||fp.count<1)continue;
        const room=Math.max(0,tp.carryingCapacity-tp.count);
        const driverStrength=Math.max(pressureDelta,seasonalDriver?seasonalPull:.0);
        const amount=round(Math.min(fp.count*.018,.35,room,Math.max(.03,driverStrength*.15)));
        if(amount>0)moves.push({species,fromChunkId:from.id,toChunkId:to.id,amount});
      }
    }
  }
  return moves;
}

export function applyWildlifeMigration(chunks:Map<string,CoarseChunkState>,moves:WildlifeMigration[]){
  for(const move of moves){
    const from=chunks.get(move.fromChunkId),to=chunks.get(move.toChunkId);
    if(!from||!to)continue;
    ensureWildlifePopulations(from);ensureWildlifePopulations(to);
    const source=from.wildlife!.find(x=>x.species===move.species)!;
    const target=to.wildlife!.find(x=>x.species===move.species)!;
    const room=Math.max(0,target.carryingCapacity-target.count);
    const actual=Math.min(source.count,room,Math.max(0,move.amount));
    if(actual<=0)continue;
    const total=target.count+actual;
    const importedContribution=total>0?clamp((source.diseaseLoad||0)*(actual/total)):0;
    target.diseaseLoad=total>0?clamp(((target.diseaseLoad||0)*target.count+(source.diseaseLoad||0)*actual)/total):target.diseaseLoad;
    target.importedDiseasePressure=clamp(Math.max((target.importedDiseasePressure||0)*.9,importedContribution));
    source.count=round(source.count-actual);
    target.count=round(total);
  }
}

export function wildlifeCount(chunk:CoarseChunkState){
  return ensureWildlifePopulations(chunk).reduce((sum,p)=>sum+p.count,0);
}

export function plantBiomassTotal(chunk:CoarseChunkState){
  const p=ensurePlantBiomass(chunk);
  return p.grass+p.shrub+p.fruit+p.crop;
}
