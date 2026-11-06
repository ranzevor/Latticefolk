import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';
import * as random from '../src/world/worldRandom.js';
import * as layouts from '../src/world/streamedLayouts.js';
import { FinePhysicsAuthority } from '../src/world/finePhysics.js';
import { PortableObjectRuntime, type PortableObjectHost } from '../src/world/portableObjectRuntime.js';
import { restoredPlayerPosition, advancePickupRespawn } from '../src/world/portableObjects.js';
import { normalizeWorldObjectRigidBody, worldObjectRigidBody } from '../src/world/movablePhysics.js';
import { restoreBuildingForLayout } from '../src/world/buildingRestore.js';
import { droppedParcelLabel, droppedParcelSpec, DROPPED_PARCEL_SOURCE } from '../src/scene/droppedParcel.js';
import { isBakingOven } from '../src/scene/bakingOven.js';
import { disposeFarmCropRows } from '../src/scene/farmCrops.js';
import { WorldPersistence } from '../server/worldPersistence.js';
import { sourceGltf } from './helpers/source-gltf.js';
import type { DecisionRequest, DecisionResponse, NpcState, WorldPersistenceSnapshot } from '../src/types.js';

const source=ts.createSourceFile('main.ts',fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const cls=source.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='TownGame') as ts.ClassDeclaration;
const names=['initializePersistence','restoreWorldState','buildWorldSnapshot','postFineDecision','requestDecision','snapshot','allowedActions',
  'applyDecision','applyStateShift','dropNpcItem','addObject','addAssetObject','registerWorldObjectPhysics','defaultCapabilities',
  'attachVisualTarget','applyVisualTarget','normalizeModel','alignNpcVisualToGround','groundHeightAt','playerOverlapsObjectTrigger',
  'objectForAction','planNpcObjectPath','findPath','completeTask','pickupForNpc','itemName'];
const methods=names.map(name=>{
  const member=cls.members.find(node=>ts.isMethodDeclaration(node)&&node.name.getText(source)===name);
  assert.ok(member,`Missing TownGame method: ${name}`);return member.getText(source);
});
const code=ts.transpileModule(`return class Runtime {${methods.join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const idle:DecisionResponse={source:'test-bounded-idle',action:'idle',stateShift:'stable',commitment:1,confidence:1,reasonCode:'parcel-idle'};
const donor:NpcState={id:'ren',name:'莲',role:'baker',position:{x:10,z:-1.8},home:{x:-12,z:-17},workAt:'oven',
  mood:'neutral',hunger:20,energy:80,social:65,money:10,inventory:[{kind:'bread',count:2}],relationships:{},memories:[],
  currentAction:'idle',goal:'drop one parcel',lastDecisionAt:0};
const inventory=()=>({apple:0,bread:0,wood:0,coin:10,flower:0,grain:0,flour:0,water:0,stone:0,plank:0,tool:0});
const initial=():WorldPersistenceSnapshot=>({version:1,meta:{day:1,minuteOfDay:495,weather:'clear',playerPosition:{x:10.7,z:0},playerInventory:inventory()},
  coarseChunks:[],fineChunks:[],homeNpcs:[structuredClone(donor)],homeObjects:[]});
type Held={resolve:(reply:unknown)=>void;payload:DecisionResponse};
const spec=ts.createSourceFile('portable-objects.spec.ts',fs.readFileSync(new URL('../e2e/portable-objects.spec.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
let homeRouteCondition:ts.Expression|undefined;
function findHomeRoute(node:ts.Node){
  if(ts.isIfStatement(node)&&node.thenStatement.getText(spec).includes('parcel-home-drop'))homeRouteCondition=node.expression;
  ts.forEachChild(node,findHomeRoute);
}
findHomeRoute(spec);assert.ok(homeRouteCondition);
const proposesDrop=new Function('input','donor','enabled','proposed','armedAfter',`return ${homeRouteCondition.getText(spec)};`) as
  (input:DecisionRequest,donor:NpcState,enabled:boolean,proposed:boolean,armedAfter:number)=>boolean;

function fixture(store:WorldPersistence,phase:'success'|'fetch'|'body'|'queued'='success',routeReply?:(input:DecisionRequest)=>Promise<DecisionResponse>){
  let time=1000,timerId=0,enabled=false,proposed=false,armedAfter=Infinity;
  const routes:(()=>void)[]=[];
  const timers=new Map<number,{at:number;callback:()=>void}>(),signals:AbortSignal[]=[],requests:DecisionRequest[]=[],held:Held[]=[];
  const dependencies={...random,...layouts,THREE,restoredPlayerPosition,normalizeWorldObjectRigidBody,worldObjectRigidBody,
    restoreBuildingForLayout,droppedParcelSpec,disposeFarmCropRows,isBakingOven,keyOf:(x:number,z:number)=>`${x},${z}`,now:()=>time,Date:{now:()=>10_000+time},
    dist:(a:{x:number;z:number},b:{x:number;z:number})=>Math.hypot(a.x-b.x,a.z-b.z),
    setTimeout:(callback:()=>void,delay:number)=>{const id=++timerId;timers.set(id,{at:time+delay,callback});return id;},clearTimeout:(id:number)=>timers.delete(id),
    i18n:{t:(key:string)=>key},
    fetch:async(url:string,options?:RequestInit)=>{
      if(url==='/api/world/state')return {ok:true,json:async()=>({snapshot:store.load(),revision:store.revision()})};
      assert.equal(url,'/api/decision');
      const input=JSON.parse(options!.body as string) as DecisionRequest;requests.push(input);signals.push(options!.signal as AbortSignal);
      const respond=async()=>{
        const drop=!routeReply&&proposesDrop(input,donor,enabled,proposed,armedAfter);
        if(drop){assert.ok(input.allowedActions.includes('drop_item'));proposed=true;}
        const payload=routeReply?await routeReply(input):{...idle,...(drop?{action:'drop_item' as const,reasonCode:'parcel-home-drop'}:{})};
        const controlled=payload.action!=='idle';
        if(controlled&&phase==='fetch')return new Promise<unknown>(resolve=>held.push({resolve,payload}));
        return {ok:true,json:()=>controlled&&phase==='body'?new Promise(resolve=>held.push({resolve,payload})):Promise.resolve(payload)};
      };
      return phase==='queued'?new Promise(resolve=>routes.push(()=>resolve(respond()))):respond();
    }};
  const Runtime=new Function(...Object.keys(dependencies),code)(...Object.values(dependencies));
  const game=new Runtime();
  Object.assign(game,{scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),physics:new FinePhysicsAuthority(),
    npcs:new Map(),objects:new Map(),materializedChunks:new Map(),fineChunkCache:new Map(),visualTargets:[],assets:new Map(),
    assetsReady:false,assetLoadFailures:[],randomness:random.readWorldRandomness(undefined),streamedLayouts:new layouts.StreamedLayoutRegistry(random.DEFAULT_WORLD_SEED),
    streamedPresentation:{physicsOwner:()=>undefined},coarseWorld:{chunks:new Map(),restoreKnownChunks(){},ensureWindowAround(){},chunkAtWorld(){return undefined;}},
    wildlifeLineage:new Map(),wildlifeTransfers:new Map(),lineageEpoch:0,playerInventory:inventory(),playerPosition:{x:0,z:7},
    day:1,minuteOfDay:495,weather:'clear',weatherEpoch:0,cameraMode:'firstPerson',perceptionEpoch:0,inFlight:0,
    persistenceReady:false,persistenceRevision:0,persistenceConflict:false,persistenceLoadBlocked:false,
    initializeWorld(){const mesh=new THREE.Group();this.scene.add(mesh);this.npcs.set(donor.id,{state:{...structuredClone(donor),position:{x:-9,z:-11}},mesh,path:[],pathIndex:0,nextDecisionAt:0,pendingDecision:false});},
    clearMovablePersistenceQueue(){},updateFineChunkMaterialization(){},reconcileLineageOffspring(){},scheduleMovablePersistence(){},event(){},log(){},
    gameTimeText:()=> '08:15',recentEvents:[],parcelLabel:(kind:string,count:number)=>droppedParcelLabel('en',kind,count)});
  game.portables=new PortableObjectRuntime(game as PortableObjectHost,()=> 'home_drop');
  return {game,timers,signals,requests,held,routes,stamp:()=>10_000+time,enable(){armedAfter=10_000+time;enabled=true;},proposed:()=>proposed,
    async advance(ms:number){time+=ms;for(const[id,timer]of timers)if(timer.at<=time){timers.delete(id);timer.callback();}for(let i=0;i<12;i++)await Promise.resolve();}};
}

test('home parcel entry waits for settled licensed assets, not the initially empty failure list',async()=>{
  const open=spec.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='open');assert.ok(open);
  const data={portableObjects:'{"parcels":[]}',persistenceRevision:'2',assetsReady:'false',assetFailures:'0'};
  let pendingObserved=false,readyAtReturn=false;
  const document={querySelector:()=>({dataset:data})};
  const page={async addInitScript(){},async goto(){},locator:()=>data,
    async waitForFunction(predicate:()=>boolean,_arg:unknown,options:{timeout:number}){
      assert.equal(options.timeout,45_000);
      if(!predicate()){pendingObserved=true;data.assetsReady='true';assert.ok(predicate());}
      readyAtReturn=data.assetsReady==='true';
    }};
  const expect=(actual:typeof data)=>({async toHaveAttribute(name:string,value:string){assert.equal(actual.assetFailures,value);assert.equal(name,'data-asset-failures');}});
  const run=new Function('document','startFirstPerson','expect',ts.transpileModule(`${open.getText(spec)}\nreturn open;`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(document,async()=>{},expect);
  await run(page);assert.equal(pendingObserved,true);assert.equal(readyAtReturn,true);
});

for(const phase of ['fetch','body'] as const)test(`the single home proposal can expire during ${phase} without any parcel or inventory debit`,async()=>{
  const store=new WorldPersistence(':memory:');try{
    store.save(initial(),store.revision());const f=fixture(store,phase);await f.game.initializePersistence();
    assert.deepEqual(f.game.playerPosition,{x:10.7,z:0});f.enable();await f.advance(1);
    const agent=f.game.npcs.get(donor.id),pending=f.game.requestDecision(agent);await f.advance(0);
    assert.equal(f.proposed(),true);assert.equal(f.held.length,1);assert.deepEqual(f.requests[0].npc.position,donor.position);
    assert.ok(f.requests[0].world.nearbyNpcs.some(npc=>npc.id==='player'));
    await f.advance(8000);await pending;
    assert.equal(f.signals[0].aborted,true);assert.equal(agent.pendingDecision,false);assert.equal(f.game.inFlight,0);
    assert.equal(agent.state.inventory[0].count,2);assert.deepEqual(f.game.portables.diagnostics().parcels,[]);
    const late=f.held[0];late.resolve(phase==='fetch'?{ok:true,json:async()=>late.payload}:late.payload);await f.advance(0);
    await f.game.requestDecision(agent);
    assert.equal(f.requests.length,2);assert.equal(f.proposed(),true);assert.equal(agent.state.currentAction,'idle');
    assert.equal(agent.state.inventory[0].count,2);assert.deepEqual(f.game.portables.diagnostics().parcels,[]);
  }finally{store.close();}
});

for(const delay of [1,7999,8000])test(`a ${delay}ms-old request and an arming-millisecond request cannot consume the only home proposal`,async()=>{
  const store=new WorldPersistence(':memory:');try{
    store.save(initial(),store.revision());const f=fixture(store,'queued');await f.game.initializePersistence();
    const agent=f.game.npcs.get(donor.id),old=f.game.requestDecision(agent);await f.advance(delay);
    f.enable();f.routes.shift()!();await old;
    assert.equal(f.proposed(),false);assert.deepEqual(f.game.portables.diagnostics().parcels,[]);
    const sameMillisecond=f.game.requestDecision(agent);f.routes.shift()!();await sameMillisecond;
    assert.equal(f.proposed(),false);
    await f.advance(1);const fresh=f.game.requestDecision(agent);f.routes.shift()!();await fresh;
    assert.equal(f.proposed(),true);assert.equal(agent.state.inventory[0].count,1);assert.equal(f.game.portables.diagnostics().parcels.length,1);
    assert.equal(f.requests.length,3);assert.equal(f.signals[0].aborted,delay===8000);
  }finally{store.close();}
});

test('a changed perception epoch rejects the single home proposal without inventing a second drop',async()=>{
  const store=new WorldPersistence(':memory:');try{
    store.save(initial(),store.revision());const f=fixture(store,'body');await f.game.initializePersistence();f.enable();await f.advance(1);
    const agent=f.game.npcs.get(donor.id),pending=f.game.requestDecision(agent);await f.advance(0);
    f.game.perceptionEpoch++;f.held[0].resolve(f.held[0].payload);await pending;
    assert.equal(f.proposed(),true);assert.equal(agent.state.inventory[0].count,2);assert.deepEqual(f.game.portables.diagnostics().parcels,[]);
    assert.equal(f.timers.size,0);assert.equal(f.game.inFlight,0);
  }finally{store.close();}
});

test('a restored home donor creates one licensed parcel through deferred and ready templates and survives SQLite consumption',async()=>{
  const template=(await sourceGltf(DROPPED_PARCEL_SOURCE)).scene;
  for(const ready of [false,true]){
    const store=new WorldPersistence(':memory:');try{
      store.save(initial(),store.revision());const f=fixture(store);await f.game.initializePersistence();
      const agent=f.game.npcs.get(donor.id);assert.deepEqual(agent.state.position,donor.position);assert.ok(agent.nextDecisionAt>=1700&&agent.nextDecisionAt<3500);
      if(ready)f.game.assets.set('crate_rts',{scene:template,animations:[]});
      f.enable();await f.advance(1);await f.game.requestDecision(agent);
      let parcels=f.game.portables.diagnostics().parcels;assert.equal(parcels.length,1);assert.equal(parcels[0].visible,true);
      assert.equal(parcels[0].renderedChildren,ready?1:0);assert.equal(agent.state.inventory[0].count,1);
      if(!ready){f.game.assets.set('crate_rts',{scene:template,animations:[]});for(const target of f.game.visualTargets)f.game.applyVisualTarget(target);}
      parcels=f.game.portables.diagnostics().parcels;assert.equal(parcels[0].renderedChildren,1);
      assert.deepEqual(parcels[0].position,{x:10.7,z:-1.4});assert.equal(parcels[0].chunkId,null);
      const mesh=f.game.objects.get('home_drop').mesh as THREE.Group;let meshes=0;mesh.traverse(node=>{if((node as THREE.Mesh).isMesh)meshes++;});assert.ok(meshes>0);
      store.save(f.game.buildWorldSnapshot(),store.revision());const reload=fixture(store);reload.game.assets.set('crate_rts',{scene:template,animations:[]});await reload.game.initializePersistence();
      assert.deepEqual(reload.game.playerPosition,{x:10.7,z:0});assert.equal(reload.game.portables.diagnostics().parcels[0].renderedChildren,1);
      const object=reload.game.objects.get('home_drop');assert.equal(object.state.resourceAmount,1);assert.equal(object.state.respawnAt,undefined);
      assert.deepEqual(reload.game.portables.pickupForPlayer(object),{kind:'bread',count:1});
      assert.equal(reload.game.portables.pickupForPlayer(object),undefined);assert.equal(advancePickupRespawn(object.state,Date.now()+46_000),false);
      store.save(reload.game.buildWorldSnapshot(),store.revision());const after=store.load()!;
      assert.deepEqual(after.meta.playerPosition,{x:10.7,z:0});assert.equal(after.meta.playerInventory.bread,1);
      assert.equal(after.homeNpcs[0].inventory[0].count,1);assert.equal(after.homeObjects.some(object=>object.id==='home_drop'),false);
    }finally{store.close();}
  }
});

function e2eParcelRoute(reasonCode:string){
  let handler:ts.Node|undefined;
  function visit(node:ts.Node){
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='route'
      &&node.arguments[0]?.getText(spec)==="'**/api/decision'"&&node.arguments[1]?.getText(spec).includes(reasonCode))handler=node.arguments[1];
    ts.forEachChild(node,visit);
  }
  visit(spec);assert.ok(handler,`Missing parcel route: ${reasonCode}`);return handler.getText(spec);
}
const routeExpect=(actual:unknown)=>({toEqual:(expected:unknown)=>assert.deepEqual(actual,expected),
  toContain:(expected:unknown)=>assert.ok((actual as unknown[]).includes(expected)),toBe:(expected:unknown)=>assert.equal(actual,expected)});
const routeDonor={id:donor.id,x:donor.position.x,z:donor.position.z};
function fineDropRoute(){
  const compiled=ts.transpileModule(`let proposed=false,armedAfter=Infinity;
    const handle=${e2eParcelRoute('parcel-fine-drop')};
    return {async reply(input){let payload;await handle({request:()=>({postDataJSON:()=>input}),fulfill:async({json})=>{payload=json;}});return payload;},
      armDrop(at){armedAfter=at;},proposed:()=>proposed};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return new Function('donor','idle','expect',compiled)(routeDonor,idle,routeExpect) as {
    reply(input:DecisionRequest):Promise<DecisionResponse>;armDrop(at:number):void;proposed():boolean;
  };
}
function boundedParcelRoute(){
  const compiled=ts.transpileModule(`let dropped=false,pickupEnabled=false,picked=false,targetId;
    let dropArmedAfter=Infinity,pickupArmedAfter=Infinity;const proposals=[];
    const handle=${e2eParcelRoute('npc-parcel-drop')};
    return {async reply(input){let payload;await handle({request:()=>({postDataJSON:()=>input}),fulfill:async({json})=>{payload=json;}});return payload;},
      armDrop(at){dropArmedAfter=at;},armPickup(at,id){pickupArmedAfter=at;targetId=id;pickupEnabled=true;},
      proposed:()=>dropped,picked:()=>picked,proposals};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return new Function('donor','idle','expect',compiled)(routeDonor,idle,routeExpect) as {
    reply(input:DecisionRequest):Promise<DecisionResponse>;armDrop(at:number):void;armPickup(at:number,id:string):void;
    proposed():boolean;picked():boolean;proposals:{response:DecisionResponse}[];
  };
}
function fineDonor(f:ReturnType<typeof fixture>){
  const agent=f.game.npcs.get(donor.id);agent.state.chunkId='chunk_2_0';
  f.game.materializedChunks.set('chunk_2_0',{npcIds:[donor.id],objectIds:[],groups:[],wildlifeIds:[]});return agent;
}
for(const name of ['fine','bounded'] as const)for(const phase of ['fetch','body','queued'] as const)
  test(`${name} drop rejects preparation requests across the ${phase} boundary and proposes once after arming`,async()=>{
    const store=new WorldPersistence(':memory:');try{
      store.save(initial(),store.revision());const route=name==='fine'?fineDropRoute():boundedParcelRoute();
      const f=fixture(store,phase,input=>route.reply(input));await f.game.initializePersistence();const agent=fineDonor(f);
      const preparing=f.game.requestDecision(agent);await f.advance(0);
      assert.equal(route.proposed(),false);
      if(phase==='queued')await f.advance(8000);else await preparing;
      f.game.assetsReady=true;route.armDrop(f.stamp());
      if(phase==='queued'){f.routes.shift()!();await preparing;}
      assert.equal(route.proposed(),false);assert.equal(agent.state.inventory[0].count,2);assert.deepEqual(f.game.portables.diagnostics().parcels,[]);
      const sameMillisecond=f.game.requestDecision(agent);if(phase==='queued')f.routes.shift()!();await sameMillisecond;
      assert.equal(route.proposed(),false);
      await f.advance(1);const fresh=f.game.requestDecision(agent);if(phase==='queued')f.routes.shift()!();await f.advance(0);
      if(phase!=='queued'){assert.equal(f.held.length,1);const held=f.held[0];held.resolve(phase==='fetch'?{ok:true,json:async()=>held.payload}:held.payload);}
      await fresh;assert.equal(route.proposed(),true);assert.equal(agent.state.inventory[0].count,1);
      assert.equal(f.game.portables.diagnostics().parcels.length,1);assert.equal(f.game.portables.diagnostics().parcels[0].chunkId,'chunk_2_0');
      const later=f.game.requestDecision(agent);if(phase==='queued')f.routes.shift()!();await later;
      assert.equal(agent.state.inventory[0].count,1);assert.equal(f.game.portables.diagnostics().parcels.length,1);
    }finally{store.close();}
  });

for(const delay of [1,7999,8000])test(`bounded pickup rejects a ${delay}ms-old queued request and completes one fresh conserved transfer`,async()=>{
  const store=new WorldPersistence(':memory:');try{
    store.save(initial(),store.revision());const route=boundedParcelRoute(),f=fixture(store,'queued',input=>route.reply(input));
    await f.game.initializePersistence();const agent=fineDonor(f);f.game.assetsReady=true;route.armDrop(f.stamp());await f.advance(1);
    const drop=f.game.requestDecision(agent);f.routes.shift()!();await drop;
    assert.equal(route.proposed(),true);assert.equal(agent.state.inventory[0].count,1);
    const object=f.game.objects.get('home_drop');assert.ok(object);assert.equal(object.state.chunkId,'chunk_2_0');
    const old=f.game.requestDecision(agent);await f.advance(delay);route.armPickup(f.stamp(),object.state.id);f.routes.shift()!();await old;
    assert.equal(route.picked(),false);assert.equal(agent.state.inventory[0].count,1);assert.equal(f.game.objects.has(object.state.id),true);
    const sameMillisecond=f.game.requestDecision(agent);f.routes.shift()!();await sameMillisecond;assert.equal(route.picked(),false);
    await f.advance(1);const fresh=f.game.requestDecision(agent);f.routes.shift()!();await fresh;
    assert.equal(route.picked(),true);assert.equal(agent.task?.action,'pickup');f.game.completeTask(agent);
    assert.equal(agent.state.inventory[0].count,2);assert.equal(f.game.objects.has(object.state.id),false);
    assert.deepEqual(f.game.portables.diagnostics().parcels,[]);f.game.completeTask(agent);assert.equal(agent.state.inventory[0].count,2);
    const later=f.game.requestDecision(agent);f.routes.shift()!();await later;
    assert.equal(route.proposals.filter(proposal=>proposal.response.action==='drop_item').length,1);
    assert.equal(route.proposals.filter(proposal=>proposal.response.action==='pickup').length,1);
    assert.equal(agent.state.inventory[0].count,2);assert.equal(f.game.playerInventory.bread,0);
  }finally{store.close();}
});
