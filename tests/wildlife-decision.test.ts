import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackWildlifeDecisions } from '../server/decision/rules.js';
import type { WildlifeDecisionBatchRequest, WildlifeMigrationCandidate, WildlifeState } from '../src/types.js';

const habitat=(patch:Partial<WildlifeMigrationCandidate>={}):WildlifeMigrationCandidate=>({
  id:'chunk_2_2',biome:'plains',distance:0,ecology:70,food:65,water:70,danger:20,settlementLevel:0,
  population:8,carryingCapacity:20,density:.4,competitionPressure:10,seasonalSuitability:70,diseasePressure:8,...patch
});
const world=(patch:Partial<WildlifeDecisionBatchRequest['requests'][number]['world']>={})=>({
  gameTime:'09:00',minuteOfDay:540,weather:'clear',currentHabitat:habitat(),nearbyChunks:[],
  nearbyResources:[],nearbyWildlife:[],...patch
});

const animal=(patch:Partial<WildlifeState>={}):WildlifeState=>({
  id:'rabbit_1',chunkId:'chunk_2_2',species:'rabbit',position:{x:0,z:0},ageDays:140,health:80,hunger:30,thirst:30,energy:70,
  sex:'female',generation:0,traits:{speed:2.4,size:.55,fertility:.9,wariness:.9},currentAction:'wander',lastDecisionAt:0,birthDay:1,...patch
});

for(const [species,action] of [['deer','graze'],['badger','forage']] as const)test(`${action} fallback excludes natural water and stone from food candidates`,()=>{
  const resources=[{id:'water',tags:['water','nature','habitat'],distance:1,resourceAmount:10},
    {id:'stone',tags:['nature','resource','stone'],distance:1,resourceAmount:10}];
  const decide=(nearbyResources:typeof resources)=>fallbackWildlifeDecisions({requests:[{
    wildlife:animal({species,hunger:85,thirst:20}),world:world({nearbyResources}),allowedActions:[action,'wander','rest']
  }]}).decisions[0]!;
  assert.equal(decide(resources).action,action);assert.equal(decide(resources).targetObjectId,undefined);
  assert.equal(decide([...resources,{id:'food',tags:['nature','forage','food'],distance:5,resourceAmount:10}]).targetObjectId,'food');
});

test('wildlife fallback prioritizes nearby predator escape',()=>{
  const req:WildlifeDecisionBatchRequest={requests:[{
    wildlife:animal(),
    world:world({nearbyWildlife:[
      {id:'fox_1',species:'fox',sex:'male',ageDays:500,distance:3,health:80,currentAction:'hunt',mateAvailable:true}
    ]}),
    allowedActions:['flee','wander','graze','rest']
  }]};
  assert.equal(fallbackWildlifeDecisions(req).decisions[0]?.action,'flee');
});

test('wildlife fallback prioritizes water under severe thirst',()=>{
  const req:WildlifeDecisionBatchRequest={requests:[{
    wildlife:animal({thirst:85}),
    world:world({gameTime:'12:00',minuteOfDay:720,nearbyResources:[
      {id:'pond',tags:['water','nature'],distance:5,resourceAmount:10}
    ]}),
    allowedActions:['drink','wander','rest']
  }]};
  const d=fallbackWildlifeDecisions(req).decisions[0]!;
  assert.equal(d.action,'drink');
  assert.equal(d.targetObjectId,'pond');
});


test('wildlife fallback avoids mating with unavailable partners',()=>{
  const req:WildlifeDecisionBatchRequest={requests:[{
    wildlife:animal({hunger:20,thirst:20,energy:80}),
    world:world({gameTime:'14:00',minuteOfDay:840,nearbyWildlife:[
      {id:'rabbit_m',species:'rabbit',sex:'male',ageDays:180,distance:2,health:85,currentAction:'wander',mateAvailable:false}
    ]}),
    allowedActions:['seek_mate','wander','rest']
  }]};
  assert.notEqual(fallbackWildlifeDecisions(req).decisions[0]?.action,'seek_mate');
});

test('disease pressure prefers recovery when no emergency need dominates',()=>{
  const req:WildlifeDecisionBatchRequest={requests:[{
    wildlife:animal({diseaseLoad:82,hunger:35,thirst:35,energy:60}),
    world:world({gameTime:'08:00',minuteOfDay:480,weather:'rain'}),
    allowedActions:['rest','wander']
  }]};
  const d=fallbackWildlifeDecisions(req).decisions[0]!;
  assert.equal(d.action,'rest');
  assert.equal(d.reasonCode,'disease_recovery');
});


test('wildlife fallback chooses bounded adjacent migration target under habitat pressure',()=>{
  const req:WildlifeDecisionBatchRequest={requests:[{
    wildlife:animal({hunger:25,thirst:25,energy:75,health:85,ageDays:160}),
    world:world({
      currentHabitat:habitat({population:19,carryingCapacity:20,density:.95,ecology:32,food:30,water:28,danger:72}),
      nearbyChunks:[
        habitat({id:'chunk_3_2',distance:24,biome:'forest',population:7,carryingCapacity:22,density:.32,ecology:82,food:72,water:70,danger:18}),
        habitat({id:'chunk_2_3',distance:24,biome:'dryland',population:14,carryingCapacity:18,density:.78,ecology:42,food:38,water:28,danger:45})
      ]
    }),
    allowedActions:['migrate','wander','rest']
  }]};
  const d=fallbackWildlifeDecisions(req).decisions[0]!;
  assert.equal(d.action,'migrate');
  assert.equal(d.targetChunkId,'chunk_3_2');
});


test('wildlife fallback can migrate away from severe niche competition',()=>{
  const req:WildlifeDecisionBatchRequest={requests:[{
    wildlife:animal({hunger:25,thirst:25,energy:75,health:85,ageDays:160}),
    world:world({
      currentHabitat:habitat({density:.55,competitionPressure:78,ecology:70,food:68,water:72,danger:20}),
      nearbyChunks:[
        habitat({id:'chunk_3_2',distance:24,biome:'forest',density:.35,competitionPressure:12,ecology:76,food:70,water:72,danger:18})
      ]
    }),
    allowedActions:['migrate','wander','rest']
  }]};
  const d=fallbackWildlifeDecisions(req).decisions[0]!;
  assert.equal(d.action,'migrate');
  assert.equal(d.targetChunkId,'chunk_3_2');
});


test('wildlife fallback can migrate toward seasonally suitable adjacent habitat',()=>{
  const req:WildlifeDecisionBatchRequest={requests:[{
    wildlife:animal({hunger:20,thirst:20,energy:80,health:90,ageDays:180}),
    world:world({
      currentHabitat:habitat({density:.45,competitionPressure:10,seasonalSuitability:10,ecology:72,food:70,water:70,danger:18}),
      nearbyChunks:[
        habitat({id:'chunk_3_2',distance:24,biome:'forest',density:.45,competitionPressure:10,seasonalSuitability:90,ecology:72,food:70,water:70,danger:18})
      ]
    }),
    allowedActions:['migrate','wander','rest']
  }]};
  const d=fallbackWildlifeDecisions(req).decisions[0]!;
  assert.equal(d.action,'migrate');
  assert.equal(d.targetChunkId,'chunk_3_2');
});


test('wildlife fallback can migrate away from severe disease transmission pressure',()=>{
  const req:WildlifeDecisionBatchRequest={requests:[{
    wildlife:animal({hunger:20,thirst:20,energy:80,health:90,ageDays:180}),
    world:world({
      currentHabitat:habitat({density:.45,competitionPressure:12,diseasePressure:82,seasonalSuitability:70,ecology:72,food:70,water:70,danger:18}),
      nearbyChunks:[
        habitat({id:'chunk_3_2',distance:24,biome:'forest',density:.45,competitionPressure:12,diseasePressure:8,seasonalSuitability:72,ecology:72,food:70,water:70,danger:18})
      ]
    }),
    allowedActions:['migrate','wander','rest']
  }]};
  const d=fallbackWildlifeDecisions(req).decisions[0]!;
  assert.equal(d.action,'migrate');
  assert.equal(d.targetChunkId,'chunk_3_2');
});


test('hungry wolf hunts legal goat prey through shared predator graph',()=>{
  const req:WildlifeDecisionBatchRequest={requests:[{
    wildlife:animal({id:'wolf_1',species:'wolf',ageDays:500,hunger:82,thirst:20,energy:75}),
    world:world({nearbyWildlife:[
      {id:'goat_1',species:'goat',sex:'female',ageDays:400,distance:4,health:85,currentAction:'graze',mateAvailable:true}
    ]}),
    allowedActions:['hunt','forage','wander','rest']
  }]};
  const d=fallbackWildlifeDecisions(req).decisions[0]!;
  assert.equal(d.action,'hunt');
  assert.equal(d.targetWildlifeId,'goat_1');
});

test('goat and fox can flee a nearby wolf that can predate them',()=>{
  for(const species of ['goat','fox'] as const){
    const req:WildlifeDecisionBatchRequest={requests:[{
      wildlife:animal({id:`${species}_1`,species,ageDays:500,hunger:20,thirst:20,energy:75}),
      world:world({nearbyWildlife:[
        {id:'wolf_1',species:'wolf',sex:'male',ageDays:600,distance:3,health:90,currentAction:'hunt',mateAvailable:true}
      ]}),
      allowedActions:['flee','wander','rest']
    }]};
    const d=fallbackWildlifeDecisions(req).decisions[0]!;
    assert.equal(d.action,'flee');
    assert.equal(d.targetWildlifeId,'wolf_1');
  }
});

test('fallback mating maturity uses species life-history threshold',()=>{
  const req:WildlifeDecisionBatchRequest={requests:[{
    wildlife:animal({id:'goat_young',species:'goat',ageDays:120,hunger:20,thirst:20,energy:80,health:90}),
    world:world({nearbyWildlife:[
      {id:'goat_m',species:'goat',sex:'male',ageDays:400,distance:2,health:90,currentAction:'wander',mateAvailable:true}
    ]}),
    allowedActions:['seek_mate','wander','rest']
  }]};
  assert.notEqual(fallbackWildlifeDecisions(req).decisions[0]?.action,'seek_mate');
});

test('hungry badger hunts rabbit through profile-driven omnivore predation',()=>{
  const req:WildlifeDecisionBatchRequest={requests:[{
    wildlife:animal({id:'badger_1',species:'badger',ageDays:500,hunger:82,thirst:20,energy:75}),
    world:world({nearbyWildlife:[
      {id:'rabbit_prey',species:'rabbit',sex:'female',ageDays:180,distance:4,health:85,currentAction:'graze',mateAvailable:true}
    ]}),
    allowedActions:['hunt','forage','wander','rest']
  }]};
  const d=fallbackWildlifeDecisions(req).decisions[0]!;
  assert.equal(d.action,'hunt');
  assert.equal(d.targetWildlifeId,'rabbit_prey');
});

test('hungry badger falls back to profile forage when no legal prey is nearby',()=>{
  const req:WildlifeDecisionBatchRequest={requests:[{
    wildlife:animal({id:'badger_2',species:'badger',ageDays:500,hunger:82,thirst:20,energy:75}),
    world:world({nearbyResources:[
      {id:'berry_bush',tags:['nature','forage','food'],distance:3,resourceAmount:5}
    ]}),
    allowedActions:['hunt','forage','wander','rest']
  }]};
  const d=fallbackWildlifeDecisions(req).decisions[0]!;
  assert.equal(d.action,'forage');
  assert.equal(d.targetObjectId,'berry_bush');
  assert.equal(d.reasonCode,'omnivore_forage');
});

test('risk-tolerance phenotype changes predator flee distance without changing legal action bounds',()=>{
  const cautious=animal({
    id:'rabbit_cautious',
    phenotype:{
      morphology:{bodyLength:1,bodyHeight:1,legLength:1,headScale:1,tailScale:1},
      behavior:{forageDrive:1,migrationDrive:1,riskTolerance:.7,recoveryDrive:1}
    }
  });
  const bold=animal({
    id:'rabbit_bold',
    phenotype:{
      morphology:{bodyLength:1,bodyHeight:1,legLength:1,headScale:1,tailScale:1},
      behavior:{forageDrive:1,migrationDrive:1,riskTolerance:1.3,recoveryDrive:1}
    }
  });
  const predator={id:'fox_edge',species:'fox' as const,sex:'male' as const,ageDays:500,distance:5.2,health:85,currentAction:'hunt' as const,mateAvailable:true};
  const cautiousDecision=fallbackWildlifeDecisions({requests:[{
    wildlife:cautious,world:world({nearbyWildlife:[predator]}),allowedActions:['flee','wander','rest']
  }]}).decisions[0]!;
  const boldDecision=fallbackWildlifeDecisions({requests:[{
    wildlife:bold,world:world({nearbyWildlife:[predator]}),allowedActions:['flee','wander','rest']
  }]}).decisions[0]!;
  assert.equal(cautiousDecision.action,'flee');
  assert.equal(cautiousDecision.targetWildlifeId,'fox_edge');
  assert.equal(boldDecision.action,'wander');
});

test('migration-drive phenotype lowers only the required habitat gain for an already pressured animal',()=>{
  const current=habitat({ecology:70,seasonalSuitability:40,density:.5,competitionPressure:10,diseasePressure:8,danger:20,food:65,water:70});
  const target=habitat({id:'chunk_3_2',ecology:81,seasonalSuitability:90,density:.5,competitionPressure:10,diseasePressure:8,danger:20,food:65,water:70});
  const state=(id:string,migrationDrive:number)=>animal({
    id,hunger:20,thirst:20,energy:80,health:90,ageDays:180,
    phenotype:{
      morphology:{bodyLength:1,bodyHeight:1,legLength:1,headScale:1,tailScale:1},
      behavior:{forageDrive:1,migrationDrive,riskTolerance:1,recoveryDrive:1}
    }
  });
  const decide=(wildlife:WildlifeState)=>fallbackWildlifeDecisions({requests:[{
    wildlife,
    world:world({currentHabitat:current,nearbyChunks:[target]}),
    allowedActions:['migrate','wander','rest']
  }]}).decisions[0]!;
  assert.equal(decide(state('rabbit_migrate_high',1.25)).action,'migrate');
  assert.equal(decide(state('rabbit_migrate_low',.75)).action,'wander');
});

test('individual organism niche genome changes bounded forage target ranking',()=>{
  const genome={
    family:'mustelid' as const,
    material:{hueShift:0,lightnessShift:0,accentShift:0},
    niche:{grass:.94,shrub:.88,fruit:1.14,crop:.90},
    locomotion:{stride:1,endurance:1}
  };
  const req:WildlifeDecisionBatchRequest={requests:[{
    wildlife:animal({id:'badger_niche',species:'badger',ageDays:500,hunger:82,thirst:20,energy:75,organismGenome:genome}),
    world:world({nearbyResources:[
      {id:'shrub_patch',tags:['food','forage','nature'],distance:3,resourceAmount:5},
      {id:'fruit_patch',tags:['food','forage','fruit','apple'],distance:3,resourceAmount:5},
      {id:'crop_patch',tags:['food','forage','farm','crop'],distance:3,resourceAmount:5}
    ]}),
    allowedActions:['forage','wander','rest']
  }]};
  const d=fallbackWildlifeDecisions(req).decisions[0]!;
  assert.equal(d.action,'forage');
  assert.equal(d.targetObjectId,'fruit_patch');
});

test('archetype-composed lynx hunts through the shared predator graph',()=>{
  const req:WildlifeDecisionBatchRequest={requests:[{
    wildlife:animal({id:'lynx_1',species:'lynx',ageDays:500,hunger:84,thirst:20,energy:76}),
    world:world({nearbyWildlife:[
      {id:'rabbit_for_lynx',species:'rabbit',sex:'female',ageDays:180,distance:3,health:82,currentAction:'graze',mateAvailable:true}
    ]}),
    allowedActions:['hunt','wander','rest']
  }]};
  const d=fallbackWildlifeDecisions(req).decisions[0]!;
  assert.equal(d.action,'hunt');
  assert.equal(d.targetWildlifeId,'rabbit_for_lynx');
});

test('lynx can flee wolf because legality comes from the same shared prey graph',()=>{
  const req:WildlifeDecisionBatchRequest={requests:[{
    wildlife:animal({id:'lynx_prey',species:'lynx',ageDays:500,hunger:20,thirst:20,energy:78}),
    world:world({nearbyWildlife:[
      {id:'wolf_threat',species:'wolf',sex:'male',ageDays:700,distance:3,health:90,currentAction:'hunt',mateAvailable:true}
    ]}),
    allowedActions:['flee','wander','rest']
  }]};
  const d=fallbackWildlifeDecisions(req).decisions[0]!;
  assert.equal(d.action,'flee');
  assert.equal(d.targetWildlifeId,'wolf_threat');
});

test('archetype-composed raccoon uses shared omnivore fallback to hunt legal rabbit prey',()=>{
  const req:WildlifeDecisionBatchRequest={requests:[{
    wildlife:animal({id:'raccoon_1',species:'raccoon',ageDays:400,hunger:84,thirst:20,energy:76}),
    world:world({nearbyWildlife:[
      {id:'rabbit_for_raccoon',species:'rabbit',sex:'female',ageDays:180,distance:2.5,health:82,currentAction:'graze',mateAvailable:true}
    ]}),
    allowedActions:['hunt','forage','wander','rest']
  }]};
  const d=fallbackWildlifeDecisions(req).decisions[0]!;
  assert.equal(d.action,'hunt');
  assert.equal(d.targetWildlifeId,'rabbit_for_raccoon');
});

test('archetype-composed raccoon falls back to fruit-biased forage when legal prey is absent',()=>{
  const req:WildlifeDecisionBatchRequest={requests:[{
    wildlife:animal({id:'raccoon_2',species:'raccoon',ageDays:400,hunger:84,thirst:20,energy:76}),
    world:world({nearbyResources:[
      {id:'fruit_tree',tags:['food','forage','fruit','apple'],distance:3,resourceAmount:5},
      {id:'grass_patch',tags:['food','nature','grass'],distance:3,resourceAmount:5}
    ]}),
    allowedActions:['hunt','forage','wander','rest']
  }]};
  const d=fallbackWildlifeDecisions(req).decisions[0]!;
  assert.equal(d.action,'forage');
  assert.equal(d.targetObjectId,'fruit_tree');
});

test('bison capability bounds keep predator intent unavailable to the shared fallback',()=>{
  const req:WildlifeDecisionBatchRequest={requests:[{
    wildlife:animal({id:'bison_1',species:'bison',ageDays:700,hunger:84,thirst:20,energy:76}),
    world:world({nearbyWildlife:[
      {id:'rabbit_near_bison',species:'rabbit',sex:'female',ageDays:180,distance:2,health:82,currentAction:'graze',mateAvailable:true}
    ],nearbyResources:[
      {id:'grass_for_bison',tags:['food','nature','grass'],distance:2,resourceAmount:5}
    ]}),
    allowedActions:['graze','wander','rest']
  }]};
  const d=fallbackWildlifeDecisions(req).decisions[0]!;
  assert.equal(d.action,'graze');
  assert.equal(d.targetObjectId,'grass_for_bison');
  assert.equal(d.targetWildlifeId,undefined);
});

test('monster warg hunts domesticated sheep through shared bounded fallback',()=>{
  const req:WildlifeDecisionBatchRequest={requests:[{
    wildlife:animal({id:'warg_1',species:'warg',ageDays:600,hunger:86,thirst:20,energy:78}),
    world:world({nearbyWildlife:[
      {id:'sheep_prey',species:'sheep',sex:'female',ageDays:500,distance:3,health:88,currentAction:'graze',mateAvailable:true}
    ]}),
    allowedActions:['hunt','wander','rest']
  }]};
  const d=fallbackWildlifeDecisions(req).decisions[0]!;
  assert.equal(d.action,'hunt');
  assert.equal(d.targetWildlifeId,'sheep_prey');
});

test('domesticated sheep remains a bounded grazer without predator capability',()=>{
  const req:WildlifeDecisionBatchRequest={requests:[{
    wildlife:animal({id:'sheep_1',species:'sheep',ageDays:600,hunger:84,thirst:20,energy:76}),
    world:world({
      nearbyWildlife:[
        {id:'rabbit_near_sheep',species:'rabbit',sex:'female',ageDays:180,distance:2,health:82,currentAction:'graze',mateAvailable:true}
      ],
      nearbyResources:[
        {id:'sheep_grass',tags:['food','nature','grass'],distance:2,resourceAmount:5}
      ]
    }),
    allowedActions:['graze','wander','rest']
  }]};
  const d=fallbackWildlifeDecisions(req).decisions[0]!;
  assert.equal(d.action,'graze');
  assert.equal(d.targetObjectId,'sheep_grass');
  assert.equal(d.targetWildlifeId,undefined);
});


