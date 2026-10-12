import type { DecisionRequest, DecisionResponse, DialogueEntry, DialogueRequest, DialogueResponse, DecisionAction, SocialIntent, StateShift, ChunkDecisionRequest, ChunkDecisionResponse, ChunkDecision, ChunkStrategy, ChunkMigrationPolicy, ChunkEcologyPolicy, RegionDecisionRequest, RegionDecisionResponse, RegionDecision, RegionPriority, RegionMovementPolicy, RegionEcologyPolicy, WorldDecisionRequest, WorldDecisionResponse, WorldDecision, WorldPriority, WorldConnectivityPolicy, WorldGrowthPolicy, WildlifeDecisionBatchRequest, WildlifeDecisionBatchResponse, WildlifeDecisionResult, WildlifeAction } from '../../src/types.js';
import { wildlifeLifeHistory } from '../../src/world/wildlifeLifeHistory.js';
import { canWildlifePredate, isWildlifePredator, wildlifeSpeciesProfile, wildlifeResourceSupportsAction } from '../../src/world/wildlifeSpecies.js';
import { normalizeWildlifePhenotype, wildlifeBehaviorThresholds } from '../../src/world/wildlifePhenotype.js';
import { normalizeWildlifeOrganismGenome, wildlifeResourceNicheScore } from '../../src/world/organismFamilies.js';

function pick<T>(arr: T[], fallback: T): T {
  return arr.length ? arr[Math.floor(Math.random() * arr.length)] : fallback;
}

export function fallbackDecision(req: DecisionRequest): DecisionResponse {
  const n = req.npc;
  const actions = new Set(req.allowedActions);
  let action: DecisionAction = req.allowedActions.includes('idle') ? 'idle' : (req.allowedActions[0] ?? 'idle');
  let reasonCode = action === 'idle' ? 'fallback_idle' : 'fallback_first_legal';

  const hour=req.world.minuteOfDay/60;
  const role=n.role;
  if (n.hunger >= 72 && actions.has('eat')) { action = 'eat'; reasonCode = 'need_hunger'; }
  else if (n.energy <= 18 && actions.has('sleep')) { action = 'sleep'; reasonCode = 'need_sleep'; }
  else if (n.energy <= 32 && actions.has('rest')) { action = 'rest'; reasonCode = 'need_energy'; }
  else if (n.social <= 28 && req.world.nearbyNpcs.length && actions.has('visit')) { action = 'visit'; reasonCode = 'need_social_visit'; }
  else if (role==='guard' && actions.has('patrol') && Math.random()<.52) { action='patrol'; reasonCode='role_patrol'; }
  else if (role==='farmer' && actions.has('harvest') && hour>=7 && hour<=17 && Math.random()<.58) { action='harvest'; reasonCode='role_harvest'; }
  else if ((role==='baker'||role==='maker') && actions.has('craft') && hour>=8 && hour<=18 && Math.random()<.52) { action='craft'; reasonCode='role_craft'; }
  else if (role==='shopkeeper' && actions.has('trade') && hour>=8 && hour<=19 && Math.random()<.56) { action='trade'; reasonCode='role_trade'; }
  else if (actions.has('deliver') && n.inventory.some(i=>i.count>0) && Math.random()<.22) { action='deliver'; reasonCode='social_delivery'; }
  else if (actions.has('gift') && n.inventory.some(i=>i.count>0) && n.social<55 && Math.random()<.15) { action='gift'; reasonCode='social_gift'; }
  else if (actions.has('fetch_water') && !n.inventory.some(i=>i.kind==='water'&&i.count>0) && Math.random()<.25) { action='fetch_water'; reasonCode='resource_water'; }
  else if (actions.has('work') && hour >= 8 && hour <= 17 && Math.random() < .42) { action = 'work'; reasonCode = 'schedule_work'; }
  else if (req.world.nearbyObjects.some(o => o.pickupable) && actions.has('pickup') && Math.random() < .18) { action = 'pickup'; reasonCode = 'opportunistic_pickup'; }
  else if (actions.has('explore') && Math.random()<.18) { action='explore'; reasonCode='curiosity_explore'; }
  else if (actions.has('wander')) { action = 'wander'; reasonCode = 'fallback_wander'; }

  const targetNpcId = ['talk','visit','trade','gift','deliver'].includes(action) ? req.world.nearbyNpcs[0]?.id : undefined;
  let targetObjectId: string | undefined;
  if (action === 'pickup') targetObjectId = req.world.nearbyObjects.find(o => o.pickupable)?.id;
  if (action === 'rest') targetObjectId = req.world.nearbyObjects.find(o => ['bed','bench'].includes(o.kind))?.id;
  if (action === 'work') targetObjectId = req.world.nearbyObjects.find(o => ['workstation','farm_plot'].includes(o.kind))?.id;
  if (action === 'eat') targetObjectId = req.world.nearbyObjects.find(o => o.kind === 'food_stall')?.id;
  if (action === 'sleep') targetObjectId = req.world.nearbyObjects.find(o => o.kind === 'bed')?.id;
  if (action === 'harvest') targetObjectId = req.world.nearbyObjects.find(o => o.kind==='farm_plot'||o.kind==='tree'||o.tags.includes('mine')||o.tags.includes('resource'))?.id;
  if (action === 'craft') targetObjectId = req.world.nearbyObjects.find(o => o.kind==='workstation')?.id;
  if (action === 'fetch_water') targetObjectId = req.world.nearbyObjects.find(o => o.kind==='well')?.id;
  if (action === 'trade' && !targetNpcId) targetObjectId = req.world.nearbyObjects.find(o => o.kind==='food_stall')?.id;

  const socialIntent: SocialIntent = pick(['greet','smalltalk','share_news'] as SocialIntent[], 'smalltalk');
  let stateShift: StateShift = 'stable';
  if (n.energy < 30) stateShift = 'energy_conserve';
  else if (n.social < 30) stateShift = 'social_seek';
  else if (n.mood === 'sad' || n.mood === 'annoyed') stateShift = 'mood_down';

  return { source:'fallback', action, targetNpcId, targetObjectId, socialIntent, stateShift, commitment: 2, confidence: .45, reasonCode };
}

export function fallbackDialogue(req: DialogueRequest, candidates: DialogueEntry[], fragments: { opener: DialogueEntry[]; body: DialogueEntry[]; closer: DialogueEntry[] }): DialogueResponse {
  if (candidates.length) {
    const e = pick(candidates.slice(0, 8), candidates[0]);
    return { source:'fallback', mode:'line', text:e.text, selectedIds:[e.id], confidence:.4, relationEffect: req.intent === 'complain' ? 'neutral' : 'positive' };
  }
  const o = pick(fragments.opener, undefined as any);
  const b = pick(fragments.body, undefined as any);
  const c = pick(fragments.closer, undefined as any);
  const selected = [o,b,c].filter(Boolean) as DialogueEntry[];
  return {
    source:'fallback', mode:'fragments', text:selected.map(x => x.text).join('') || '……',
    selectedIds:selected.map(x => x.id), confidence:.35, relationEffect:'neutral'
  };
}


export function fallbackChunkDecisions(req: ChunkDecisionRequest): ChunkDecisionResponse {
  const decisions: ChunkDecision[] = req.chunks.map(chunk => {
    let strategy: ChunkStrategy = 'sustain';
    let migrationPolicy: ChunkMigrationPolicy = 'retain';
    let ecologyPolicy: ChunkEcologyPolicy = 'balance';
    let reasonCode = 'coarse_stable';

    if (chunk.danger >= 72) {
      strategy = 'fortify';
      migrationPolicy = chunk.population > 8 ? 'release' : 'retain';
      ecologyPolicy = 'protect';
      reasonCode = 'coarse_danger';
    } else if (chunk.food < 28 || chunk.water < 24) {
      strategy = 'conserve';
      migrationPolicy = chunk.population > 10 ? 'release' : 'retain';
      ecologyPolicy = 'recover';
      reasonCode = 'coarse_scarcity';
    } else if (chunk.ecology < 34) {
      strategy = 'conserve';
      migrationPolicy = 'retain';
      ecologyPolicy = 'recover';
      reasonCode = 'coarse_ecology';
    } else if (chunk.prosperity > 62 && chunk.food > 58 && chunk.water > 52) {
      strategy = chunk.settlementLevel >= 2 ? 'trade_route' : 'grow_settlement';
      migrationPolicy = 'attract';
      ecologyPolicy = chunk.ecology > 56 ? 'balance' : 'protect';
      reasonCode = 'coarse_growth';
    } else if (chunk.wood > 72 && chunk.ecology > 58) {
      strategy = 'extract_resources';
      migrationPolicy = 'retain';
      ecologyPolicy = 'harvest';
      reasonCode = 'coarse_surplus';
    }

    return {
      chunkId: chunk.id,
      strategy,
      migrationPolicy,
      ecologyPolicy,
      confidence: .44,
      reasonCode,
      source: 'fallback',
    };
  });
  return { source: 'fallback', decisions };
}


export function fallbackRegionDecisions(req: RegionDecisionRequest): RegionDecisionResponse {
  const decisions:RegionDecision[]=req.regions.map(region=>{
    let priority:RegionPriority='balanced';
    let movementPolicy:RegionMovementPolicy='stabilize';
    let ecologyPolicy:RegionEcologyPolicy='balanced_use';
    let reasonCode='region_balanced';

    if(region.danger>=62){
      priority='security_coordination';
      movementPolicy=region.danger>=78?'restrict':'redistribute';
      ecologyPolicy='protected_network';
      reasonCode='region_danger';
    }else if(region.food<34||region.water<32){
      priority='food_security';
      movementPolicy='stabilize';
      ecologyPolicy='productive_landscape';
      reasonCode='region_scarcity';
    }else if(region.ecology<42){
      priority='ecology_recovery';
      movementPolicy='restrict';
      ecologyPolicy='restore_corridors';
      reasonCode='region_ecology';
    }else if(region.prosperity>=64&&region.settlements>=2){
      priority='trade_network';
      movementPolicy='open';
      ecologyPolicy=region.ecology>=58?'balanced_use':'protected_network';
      reasonCode='region_trade';
    }else if(region.food>58&&region.water>55&&region.prosperity>52){
      priority='settlement_growth';
      movementPolicy='open';
      ecologyPolicy='balanced_use';
      reasonCode='region_growth';
    }

    return {regionId:region.id,priority,movementPolicy,ecologyPolicy,confidence:.46,reasonCode,source:'fallback'};
  });
  return {source:'fallback',decisions};
}

export function fallbackWorldDecision(req: WorldDecisionRequest): WorldDecisionResponse {
  const s=req.summary;
  let priority:WorldPriority='resilience';
  let connectivity:WorldConnectivityPolicy='balanced_networks';
  let growth:WorldGrowthPolicy='steady';
  let reasonCode='world_resilience';

  if(s.danger>=62){
    priority='security';connectivity='localism';growth='compact';reasonCode='world_danger';
  }else if(s.ecology<42){
    priority='ecology';connectivity='balanced_networks';growth='conserve';reasonCode='world_ecology';
  }else if(s.food<38||s.water<36){
    priority='resilience';connectivity='balanced_networks';growth='conserve';reasonCode='world_scarcity';
  }else if(s.prosperity>62&&s.settlements>=8){
    priority='prosperity';connectivity='trade_corridors';growth='steady';reasonCode='world_prosperity';
  }else if(s.prosperity>52&&s.food>58&&s.water>55){
    priority='expansion';connectivity='migration_corridors';growth='frontier';reasonCode='world_expansion';
  }else if(s.ecology>72&&s.danger<30){
    priority='exploration';connectivity='migration_corridors';growth='steady';reasonCode='world_exploration';
  }

  const decision:WorldDecision={priority,connectivity,growth,confidence:.45,reasonCode,source:'fallback'};
  return {source:'fallback',decision};
}


export function fallbackWildlifeDecisions(req: WildlifeDecisionBatchRequest): WildlifeDecisionBatchResponse {
  const decisions:WildlifeDecisionResult[]=req.requests.map(entry=>{
    const animal=entry.wildlife;
    const profile=wildlifeSpeciesProfile(animal.species);
    const phenotype=normalizeWildlifePhenotype(animal.phenotype,animal.id);
    const genome=normalizeWildlifeOrganismGenome(animal.species,animal.organismGenome,animal.id);
    const thresholds=wildlifeBehaviorThresholds(phenotype);
    const forageResource=()=>entry.world.nearbyResources
      .filter(resource=>wildlifeResourceSupportsAction(animal.species,profile.feedingAction,resource))
      .sort((a,b)=>wildlifeResourceNicheScore(animal.species,genome,b.tags,b.distance)-wildlifeResourceNicheScore(animal.species,genome,a.tags,a.distance)||a.distance-b.distance)[0];
    const nearbyPredator=entry.world.nearbyWildlife.find(x=>canWildlifePredate(x.species,animal.species)&&x.distance<thresholds.fleeDistance);
    const sameMate=entry.world.nearbyWildlife.find(x=>x.species===animal.species&&x.id!==animal.id&&x.sex!==animal.sex&&x.mateAvailable&&x.distance<8);
    let action:WildlifeAction='wander';
    let targetObjectId:string|undefined;
    let targetWildlifeId:string|undefined;
    let targetChunkId:string|undefined;
    let reasonCode='wildlife_wander';
    const habitatScore=(x:typeof entry.world.currentHabitat)=>
      x.ecology*.23+x.food*.21+x.water*.17+(100-x.danger)*.14+(1-Math.min(1.5,x.density))*9-x.settlementLevel*2-x.competitionPressure*.09+x.seasonalSuitability*.12-x.diseasePressure*.08;
    const currentHabitat=entry.world.currentHabitat;
    const migrationTarget=[...entry.world.nearbyChunks]
      .sort((a,b)=>habitatScore(b)-habitatScore(a)||a.id.localeCompare(b.id))[0];
    const migrationPressure=currentHabitat.density>=.9||currentHabitat.competitionPressure>=65||currentHabitat.diseasePressure>=65||currentHabitat.seasonalSuitability<42||currentHabitat.ecology<38||currentHabitat.water<30||currentHabitat.food<34||currentHabitat.danger>70;
    const diseaseRelief=migrationTarget?currentHabitat.diseasePressure-migrationTarget.diseasePressure:0;

    if(nearbyPredator&&entry.allowedActions.includes('flee')){
      action='flee';targetWildlifeId=nearbyPredator.id;reasonCode='predator_nearby';
    }else if(animal.thirst>=72&&entry.allowedActions.includes('drink')){
      action='drink';
      targetObjectId=entry.world.nearbyResources.find(x=>wildlifeResourceSupportsAction(animal.species,'drink',x))?.id;
      reasonCode='thirst';
    }else if(animal.hunger>=thresholds.hungerThreshold){
      if(isWildlifePredator(animal.species)&&entry.allowedActions.includes('hunt')){
        const prey=entry.world.nearbyWildlife.find(x=>canWildlifePredate(animal.species,x.species)&&x.distance<10);
        if(prey){action='hunt';targetWildlifeId=prey.id;reasonCode='predator_hunger';}
        else if(entry.allowedActions.includes(profile.feedingAction)){
          action=profile.feedingAction;
          targetObjectId=forageResource()?.id;
          reasonCode=profile.trophicRole==='omnivore'?'omnivore_forage':'predator_scavenge';
        }
      }else if(entry.allowedActions.includes(profile.feedingAction)){
        action=profile.feedingAction;
        targetObjectId=forageResource()?.id;
        reasonCode='hunger';
      }
    }else if((animal.diseaseLoad||0)>=thresholds.diseaseRestThreshold&&entry.allowedActions.includes('rest')){
      action='rest';reasonCode='disease_recovery';
    }else if(animal.energy<=thresholds.energyRestThreshold&&entry.allowedActions.includes('rest')){
      action='rest';reasonCode='low_energy';
    }else if(migrationPressure&&migrationTarget&&entry.allowedActions.includes('migrate')&&(habitatScore(migrationTarget)>=habitatScore(currentHabitat)+thresholds.migrationGain||diseaseRelief>=35)){
      action='migrate';targetChunkId=migrationTarget.id;reasonCode='habitat_migration';
    }else if(animal.ageDays>=wildlifeLifeHistory(animal.species).adultAge&&animal.health>58&&animal.energy>45&&sameMate&&entry.allowedActions.includes('seek_mate')){
      action='seek_mate';targetWildlifeId=sameMate.id;reasonCode='reproduction';
    }else if(entry.allowedActions.includes(profile.feedingAction)){
      action=profile.feedingAction;
      targetObjectId=forageResource()?.id;
      reasonCode='opportunistic_forage';
    }

    if(!entry.allowedActions.includes(action))action=entry.allowedActions[0]||'rest';
    return {wildlifeId:animal.id,source:'fallback',action,targetObjectId,targetWildlifeId,targetChunkId,confidence:.55,reasonCode};
  });
  return {source:'fallback',decisions};
}

