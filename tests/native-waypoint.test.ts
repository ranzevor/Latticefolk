import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import ts from 'typescript';
import {nativeInputClock} from './helpers/native-input-clock.js';
import {FinePhysicsAuthority,type PhysicsPoint,type StaticCollider} from '../src/world/finePhysics.js';
import {registerHomeTerrain} from '../src/world/fineTerrain.js';
import {characterHeadEnvelope,playerHeadConstraint,playerHeadClearance,NPC_BODY_RADIUS} from '../src/world/characterContact.js';

type Actor={id:string;asset:string;position:PhysicsPoint;headYaw:number};
type Fixture={name:string;start:PhysicsPoint;target:PhysicsPoint;actors:Actor[];tolerance?:number;timeoutMs?:number;maxInputSeconds?:number;statics?:StaticCollider[];diagnosticStatics?:StaticCollider[]};
type Result={reached:boolean;x:number;z:number;distance:number;detours:number;inputSeconds?:number;elapsedMs?:number;stopReason?:string};
// Run the actual self-contained browser callback with keyboard events and read-only
// diagnostics, integrating unchanged production physics. This is not browser E2E.
const source=fs.readFileSync(new URL('../e2e/helpers/native-waypoint.ts',import.meta.url),'utf8');
const callback=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}})
  .outputText.replace('export async function driveNativeWaypoint','async function driveNativeWaypoint')+'\ndriveNativeWaypoint;';
const saved=JSON.parse(fs.readFileSync(new URL('./fixtures/native-waypoint-ci.json',import.meta.url),'utf8')) as Omit<Fixture,'name'>;
const actual:Fixture={...saved,name:'CI frozen actor poses'};
const actor=(id:string,asset:string,x:number,z:number,headYaw:number):Actor=>({id,asset,position:{x,z},headYaw});

async function replay(fixture:Fixture,frameMs:number,options:{loseLock?:boolean;moveActor?:boolean;intrudeAt?:number;badActors?:boolean;badPosition?:boolean;coverGoalAt?:number;uncoverGoalAt?:number;badTrees?:boolean;badCounter?:'missing'|'NaN'|'rollback'|'frozen';simulationStart?:number;rafThrows?:boolean;lateFreeze?:boolean;timerDelayMs?:number;noFrames?:boolean;frameIntervals?:number[]}={}){
  let p={...fixture.start},elapsed=0,frames=0,simulation=options.simulationStart??0;
  const actors=structuredClone(fixture.actors),held=new Set<string>(),events:Array<{type:string;code:string}>=[];
  const physics=new FinePhysicsAuthority();registerHomeTerrain(physics,72);
  for(const collider of fixture.statics??[])physics.registerStatic(collider);
  const canvas={};
  const dataset=new Proxy({},{get:(_target,key)=>{
    if(key==='playerX')return options.badPosition&&frames>0?'NaN':p.x.toFixed(4);
    if(key==='playerZ')return p.z.toFixed(4);
    if(key==='playerInputSeconds')return options.lateFreeze?String(Math.min(simulation,.1)):
      frames>0&&options.badCounter?({missing:'',NaN:'NaN',rollback:'-1',frozen:'0'}[options.badCounter]):String(simulation);
    if(key==='simulationClock')return JSON.stringify(clock.clock.diagnostics);
    if(key==='treePresentation')return options.badTrees?'{invalid':JSON.stringify((fixture.diagnosticStatics??[]).map(collider=>({collider})));
    if(key==='characterSoles'&&options.badActors)return '{invalid';
    if(key==='characterSoles')return JSON.stringify(actors.map(a=>({...a,headEnvelope:characterHeadEnvelope(a.asset)})));
    return undefined;
  },set:()=>{throw new Error('diagnostic mutation is forbidden');}});
  const document={pointerLockElement:canvas as object|null,querySelector:(selector:string)=>selector==='#game canvas'?canvas:{dataset}};
  let intrusionSteps=0;
  const clock=nativeInputClock({frameMs,frameIntervals:options.frameIntervals,timerDelayMs:options.timerDelayMs,noFrames:options.noFrames,rafThrows:options.rafThrows,onFrame:()=>{
    frames++;elapsed=frames*frameMs;
    if(options.moveActor&&frames===10)actors[0].position.z+=2;

    if(options.coverGoalAt===frames)actors[0].position.x=fixture.target.x;
    if(options.uncoverGoalAt===frames)actors[0].position.x=fixture.actors[0].position.x;
    if(options.loseLock)document.pointerLockElement=null;
  },onStep:(dt,active)=>{
    if(options.intrudeAt&&p.z>.2&&++intrusionSteps===options.intrudeAt-8)actors[1].position.z=1.44;
    const x=Number(active.has('KeyD'))-Number(active.has('KeyA')),z=Number(active.has('KeyS'))-Number(active.has('KeyW')),length=Math.hypot(x,z);
    simulation+=dt;
    const distance=(active.has('ShiftLeft')?7.2:4.5)*dt;
    p=physics.moveKinematic({id:'player',position:p,radius:.30,displacement:{x:x/length*distance,z:z/length*distance},
      dynamic:actors.map(a=>({id:a.id,...a.position,radius:NPC_BODY_RADIUS})),
      constraints:actors.map(a=>playerHeadConstraint(a.id,a.asset,a.position,a.headYaw))}).position;
  }});
  const context={...clock.context,document};
  const fn=vm.runInNewContext(callback,context) as (args:{target:PhysicsPoint;timeoutMs:number;tolerance:number;maxInputSeconds?:number})=>Promise<Result>;
  try{
    const result=await fn({target:fixture.target,timeoutMs:fixture.timeoutMs??45_000,tolerance:fixture.tolerance??.55,maxInputSeconds:fixture.maxInputSeconds});
    return {result,frames,elapsed:clock.time,events:clock.events,simulation,finalClearances:actors.map(a=>playerHeadClearance(a.asset,a.position,a.headYaw,p))};
  }finally{
    clock.finish();
  }
}

const fixtures:Fixture[]=[actual,
  {...actual,name:'reverse CI target',start:actual.target,target:actual.start},
  {...actual,name:'rotated CI layout',start:{x:-actual.start.x,z:-actual.start.z},target:{x:-actual.target.x,z:-actual.target.z},
    actors:actual.actors.map(a=>({...a,position:{x:-a.position.x,z:-a.position.z},headYaw:a.headYaw+Math.PI}))},
  {name:'wide head east',start:{x:-3,z:0},target:{x:3,z:0},actors:[actor('one','female2',0,0,0)]},
  {name:'wide head west',start:{x:3,z:0},target:{x:-3,z:0},actors:[actor('one','female2',0,0,0)]},
  {name:'rotated head north',start:{x:0,z:3},target:{x:0,z:-3},actors:[actor('one','female1',0,0,.71)]},
  {name:'staggered pair east',start:{x:-3,z:0},target:{x:5,z:0},actors:[actor('one','male1',0,-.5,1.3),actor('two','female1',2.2,.9,-.9)]},
  {name:'staggered pair west',start:{x:5,z:0},target:{x:-3,z:0},actors:[actor('one','male1',0,-.5,1.3),actor('two','female1',2.2,.9,-.9)]},
  {name:'shared long clear waypoint',start:{x:5.2,z:4},target:{x:13.95,z:3.4},actors:[],tolerance:.45},
  {name:'shared fine approach',start:{x:13.95,z:3.4},target:{x:13.95,z:2.35},actors:[],tolerance:.28,timeoutMs:12_000}
];
for(const fixture of fixtures)for(const frameMs of [16,100,500,1000])test(`${fixture.name} at ${frameMs}ms rendered steps`,async()=>{
  const {result,elapsed}=await replay(fixture,frameMs);
  assert.equal(result.reached,true,JSON.stringify(result));
  assert.ok(result.distance<=(fixture.tolerance??.55));
  assert.ok(elapsed<=(fixture.timeoutMs??45_000));
});
test('moving actor is still subject to unchanged production collision',async()=>{
  const {result}=await replay(fixtures[3],500,{moveActor:true});assert.equal(result.reached,true);
});
test('1500 ms foreground intervals preserve the original route deadline',async()=>{
  const {result,elapsed}=await replay(actual,1500);assert.equal(result.reached,true);assert.ok(elapsed<=45_000);
});
test('a frame beyond the original deadline cannot extend the route budget',async()=>{
  const {result,elapsed}=await replay(actual,45_001);assert.equal(result.reached,false);assert.equal(elapsed,45_000);
});
test('unreachable target inside an actor remains a failure',async()=>{
  const {result}=await replay({...fixtures[3],target:{x:0,z:0}},500);assert.equal(result.reached,false);
});
test('lost pointer lock throws and releases held keys',async()=>{
  await assert.rejects(replay(actual,100,{loseLock:true}),/lost pointer lock/);
});
test('already reached target sends no keyboard events',async()=>{
  const {result,events}=await replay({...actual,target:actual.start},100);assert.equal(result.reached,true);assert.equal(events.length,0);
});

for(const frameMs of [500,1000,1200])test(`tree approach retains a necessary short corner at ${frameMs}ms rendered steps`,async()=>{
  const tree={id:'object:tree_apple_2',minX:13.306533680823483,maxX:14.693466319176517,minZ:.8068058550468388,maxZ:2.1931941449531616};
  const {result,elapsed}=await replay({name:'tree approach',start:{x:13.6334,z:3.5467},target:{x:13.95,z:2.35},actors:[],
    statics:[tree],diagnosticStatics:[tree],tolerance:.28,timeoutMs:12_000},frameMs);
  assert.equal(result.reached,true,JSON.stringify(result));assert.ok(result.distance<=.28);assert.ok(elapsed<=12_000);
});

// Independent review's old-pass/new-fail static and grid-goal counterexamples.
const staticFixtures:Fixture[]=[
  {name:'unobserved static prop',start:{x:-3,z:0},target:{x:3,z:0},actors:[],
    statics:[{id:'prop',minX:-.5,maxX:.5,minZ:-.5,maxZ:.5}]},
  {name:'two unobserved static props',start:{x:-3,z:0},target:{x:3,z:0},actors:[],
    statics:[{id:'prop',minX:-.5,maxX:.5,minZ:-.5,maxZ:.5},{id:'prop2',minX:.8,maxX:1.2,minZ:.7,maxZ:1.1}]},
  {name:'NPC route meets unobserved wall',start:{x:-3,z:0},target:{x:3,z:0},actors:[actor('one','female2',0,0,0)],
    statics:[{id:'wall',minX:-3,maxX:3,minZ:1.2,maxZ:2.2}]},
  {name:'NPC wall reverse goal',start:{x:3,z:0},target:{x:-3,z:0},actors:[actor('one','female2',0,0,0)],
    statics:[{id:'wall',minX:-3,maxX:3,minZ:1.2,maxZ:2.2}]}
];
for(const fixture of staticFixtures)for(const frameMs of [16,100,500])test(`${fixture.name} at ${frameMs}ms`,async()=>{
  const {result}=await replay(fixture,frameMs);assert.equal(result.reached,true,JSON.stringify(result));assert.ok(result.distance<=.55);
});
for(const target of [{x:3.5,z:.16},{x:3.5,z:.167},{x:3.51,z:.16}])for(const frameMs of [16,100,500])test(`off-grid exact goal ${target.x},${target.z} at ${frameMs}ms`,async()=>{
  const {result}=await replay({...fixtures[3],target,tolerance:.28},frameMs);
  assert.equal(result.reached,true,JSON.stringify(result));assert.ok(result.distance<=.28);
});
for(const intrudeAt of [9,10,11,12,13,14])for(const frameMs of [100,500])test(`moving NPC enters after ${intrudeAt-8} physical detour steps, ${frameMs}ms`,async()=>{
  const fixture={...fixtures[3],actors:[actor('one','female2',0,0,0),actor('two','male1',0,10,0)]};
  const {result}=await replay(fixture,frameMs,{intrudeAt});
  assert.equal(result.reached,true,JSON.stringify(result));assert.ok(result.detours>=2,'intrusion must actually trigger fresh planning');
});
test('malformed actor diagnostic throws and releases held keys',async()=>{
  await assert.rejects(replay(actual,100,{badActors:true}),/JSON|property|position/i);
});
test('unavailable position throws and releases held keys',async()=>{
  await assert.rejects(replay(actual,100,{badPosition:true}),/position is unavailable/);
});


const secondRecorded=JSON.parse(fs.readFileSync(new URL('./fixtures/native-waypoint-second-ci.json',import.meta.url),'utf8')) as Fixture&{callStart:PhysicsPoint;checkpointRemainingMs:number};
for(const frameMs of [16,500,750])test(`recorded second-waypoint actors and tree footprints at ${frameMs}ms`,async()=>{
  const {result,elapsed,finalClearances}=await replay({...secondRecorded,start:secondRecorded.callStart},frameMs);
  assert.equal(result.reached,true,JSON.stringify(result));assert.ok(result.distance<=.45);assert.ok(elapsed<=45_000);assert.ok(finalClearances.every(d=>d>=-1e-8));
});
test('recorded pre-detour checkpoint fits its original remaining time',async()=>{
  const {result,elapsed}=await replay({...secondRecorded,timeoutMs:secondRecorded.checkpointRemainingMs},750);
  assert.equal(result.reached,true,JSON.stringify(result));assert.ok(elapsed<=secondRecorded.checkpointRemainingMs);assert.ok(result.distance<=.45);
});
test('full foreground time fits the original late-checkpoint budget',async()=>{
  const {result,elapsed}=await replay({...secondRecorded,timeoutMs:secondRecorded.checkpointRemainingMs},1000);
  assert.equal(result.reached,true);assert.ok(elapsed<=secondRecorded.checkpointRemainingMs);assert.ok(result.distance<=.45);
});
const partialGoals:Fixture[]=[
  {name:'east tolerance region',start:{x:-3,z:0},target:{x:1.6,z:.16},actors:[actor('one','female2',0,0,0)],tolerance:.28},
  {name:'west tolerance region',start:{x:3,z:0},target:{x:-1.55,z:.16},actors:[actor('one','female2',0,0,0)],tolerance:.28},
  {name:'north tolerance region',start:{x:0,z:3},target:{x:.16,z:-1.6},actors:[actor('one','female2',0,0,Math.PI/2)],tolerance:.28},
  {name:'south tolerance region',start:{x:0,z:-3},target:{x:.16,z:1.55},actors:[actor('one','female2',0,0,Math.PI/2)],tolerance:.28}
];
for(const fixture of partialGoals)for(const frameMs of [16,100,500,750])test(`${fixture.name} accepts a reachable point without enlarging tolerance at ${frameMs}ms`,async()=>{
  const a=fixture.actors[0];assert.ok(playerHeadClearance(a.asset,a.position,a.headYaw,fixture.target)<0,'the exact center really is occupied');
  const {result,finalClearances}=await replay(fixture,frameMs);assert.equal(result.reached,true,JSON.stringify(result));assert.ok(result.distance<=.28);assert.ok(finalClearances.every(d=>d>=-1e-8));
});
for(const frameMs of [100,500])test(`moving NPC invalidates the candidate region until it clears at ${frameMs}ms`,async()=>{
  const {result,frames,finalClearances}=await replay(partialGoals[0],frameMs,{coverGoalAt:11,uncoverGoalAt:30});
  assert.equal(result.reached,true,JSON.stringify(result));assert.ok(frames>=30,'must not succeed while the entire region is occupied');assert.ok(result.distance<=.28);assert.ok(finalClearances.every(d=>d>=-1e-8));
});
test('a moving NPC that keeps the entire tolerance region occupied cannot turn green',async()=>{
  const {result,elapsed}=await replay(partialGoals[0],500,{coverGoalAt:11});assert.equal(result.reached,false);assert.equal(elapsed,45_000);
});
test('malformed observed tree footprints throw and release keys',async()=>{
  await assert.rejects(replay(actual,100,{badTrees:true}),/JSON|property|position/i);
});

const restoredOverlap=JSON.parse(fs.readFileSync(new URL('./fixtures/native-waypoint-overlap-ci.json',import.meta.url),'utf8')) as Fixture;
for(const frameMs of [800,1200,1400])test(`God-return overlap from CI exits through unchanged physics at ${frameMs}ms steps`,async()=>{
  const {result,elapsed}=await replay(restoredOverlap,frameMs);
  assert.equal(result.reached,true,JSON.stringify(result));
  assert.ok(result.distance<=restoredOverlap.tolerance!);assert.ok(elapsed<=restoredOverlap.timeoutMs!);
});

const crossing:Fixture={name:'layout crossing',start:{x:0,z:0},target:{x:6,z:0},actors:[],tolerance:.3,timeoutMs:45_000,maxInputSeconds:2};
test('layout input budget crosses six metres at one rendered frame per second',async()=>{
  const {result,elapsed,simulation}=await replay(crossing,1000,{simulationStart:9});
  assert.equal(result.reached,true);assert.ok(result.distance<=.3);assert.equal(elapsed,4_000);assert.ok(simulation-9<2);
  assert.equal(result.elapsedMs,elapsed);assert.equal(result.inputSeconds,simulation-9);assert.equal(result.stopReason,'reached');
  const original=await replay({...crossing,timeoutMs:10_000,maxInputSeconds:undefined},1000);
  assert.equal(original.result.reached,true);assert.equal(original.elapsed,4_000);assert.ok(original.result.distance<=.3);assert.ok(Math.abs(original.simulation-simulation+9)<1e-8);
});
test('input budget ends an unreached route after two attempted seconds',async()=>{
  const {result,simulation,elapsed}=await replay({...crossing,target:{x:100,z:0}},50);
  assert.equal(result.reached,false);assert.ok(Math.abs(simulation-2)<1e-9);assert.equal(elapsed,2350);
  assert.equal(result.stopReason,'input-budget');
});
test('unchanged collision consumes the same input budget with zero displacement',async()=>{
  const statics=[{id:'e',minX:.3,maxX:1,minZ:-1,maxZ:1},{id:'w',minX:-1,maxX:-.3,minZ:-1,maxZ:1},
    {id:'n',minX:-1,maxX:1,minZ:-1,maxZ:-.3},{id:'s',minX:-1,maxX:1,minZ:.3,maxZ:1}];
  const {result,simulation}=await replay({...crossing,statics},50);
  assert.equal(result.reached,false);assert.equal(result.x,0);assert.equal(result.z,0);assert.ok(Math.abs(simulation-2)<1e-9);
});
test('arrival observed after the input budget cannot pass',async()=>{
  const {result,simulation}=await replay({...crossing,target:{x:.225,z:0},tolerance:.001,maxInputSeconds:.04},50,{timerDelayMs:10});
  assert.ok(result.distance<=.001);assert.equal(simulation,.05);assert.equal(result.reached,false);
});
test('arrival observed after the wall deadline cannot pass',async()=>{
  const {result,elapsed}=await replay({...crossing,target:{x:.225,z:0},tolerance:.001,timeoutMs:45_000},45_001);
  assert.equal(result.x,0);assert.equal(elapsed,45_000);assert.equal(result.reached,false);
});
test('arrival exactly at both budgets is permitted',async()=>{
  const {result}=await replay({...crossing,target:{x:.225,z:0},tolerance:.001,maxInputSeconds:.05,timeoutMs:50},50);
  assert.equal(result.reached,true);
});
for(const badCounter of ['missing','NaN','rollback'] as const)test(`input budget rejects ${badCounter} counter and releases input`,async()=>{
  await assert.rejects(replay(crossing,50,{badCounter}),/observation reset or became unavailable/);
});
test('input budget rejects pointer-lock loss and releases input',async()=>{
  await assert.rejects(replay(crossing,50,{loseLock:true}),/lost pointer lock/);
});
test('changed position cannot pass with a frozen direction-input counter',async()=>{
  await assert.rejects(replay({...crossing,target:{x:.225,z:0},tolerance:.001},50,{badCounter:'frozen'}),/without observed direction input/);
});
test('direction-input counter freezing after initial progress also fails',async()=>{
  await assert.rejects(replay(crossing,50,{lateFreeze:true}),/without observed direction input/);
});
test('failed RAF registration clears the wall watchdog and held keys',async()=>{
  await assert.rejects(replay(crossing,50,{rafThrows:true}),/RAF registration failed/);
});
for(const maxInputSeconds of [0,-1,NaN,Infinity])test(`input budget rejects invalid maximum ${maxInputSeconds}`,async()=>{
  await assert.rejects(replay({...crossing,maxInputSeconds},50),/budgets must be positive and finite/);
});
test('wall watchdog releases keys without RAF and late callbacks cannot issue input',async()=>{
  let elapsed=0,nextId=10;const held=new Set<string>(),events:string[]=[],timers=new Map<number,()=>void>(),frames=new Map<number,()=>void>(),cancelled:number[]=[];
  const canvas={},dataset={playerX:'0',playerZ:'0',playerInputSeconds:'3',characterSoles:'[]',treePresentation:'[]',simulationClock:'{"pendingSeconds":0}'};
  const document={pointerLockElement:canvas,querySelector:(selector:string)=>selector==='#game canvas'?canvas:{dataset}};
  const context={document,performance:{now:()=>elapsed},KeyboardEvent:class{
    type:string;code:string;constructor(type:string,options:{code:string}){this.type=type;this.code=options.code;}
  },window:{dispatchEvent:(event:{type:string;code:string})=>{
    events.push(event.type+':'+event.code);if(event.type==='keydown')held.add(event.code);else held.delete(event.code);return true;
  }},setTimeout:(next:()=>void,ms:number)=>{assert.ok(ms>0&&ms<=45_000);const id=++nextId;timers.set(id,next);return id;},
  clearTimeout:(id:number)=>{timers.delete(id);},requestAnimationFrame:(next:()=>void)=>{const id=++nextId;frames.set(id,next);return id;},
  cancelAnimationFrame:(id:number)=>{cancelled.push(id);frames.delete(id);}};
  const fn=vm.runInNewContext(callback,context) as (args:object)=>Promise<Result>;
  const pending=fn({target:crossing.target,timeoutMs:45_000,tolerance:.3,maxInputSeconds:2});
  assert.ok(held.size>0);assert.equal(frames.size,0);
  elapsed=250;const [pulseId,pulse]=[...timers][0];timers.delete(pulseId);pulse();await Promise.resolve();
  assert.equal(held.size,0);assert.equal(frames.size,1);const [frameId,lateFrame]=[...frames][0];
  elapsed=45_000;[...timers.values()][0]();
  const result=await pending;assert.equal(result.reached,false);assert.equal(held.size,0);assert.deepEqual(cancelled,[frameId]);assert.equal(timers.size,0);
  assert.equal(result.elapsedMs,45_000);assert.equal(result.inputSeconds,0);assert.equal(result.stopReason,'wall-budget');
  const finishedEvents=[...events];lateFrame();await Promise.resolve();assert.deepEqual(events,finishedEvents);assert.equal(held.size,0);
});


test('a five-second foreground gap drains before the next finite input pulse',async()=>{
  const {result,events,simulation,elapsed}=await replay(crossing,1000,{frameIntervals:[5000,100,100]});
  assert.equal(result.reached,true);assert.ok(result.distance<=.3);assert.ok(simulation<=2);assert.ok(elapsed<=45000);
  const presses=events.filter(e=>e.type==='keydown'&&e.code==='KeyD');
  assert.ok(presses.length>1);assert.equal(presses[1].at,5200);
  assert.equal(events.find(e=>e.type==='keyup'&&e.code==='KeyD')?.at,250);
});

test('an arrived position with unconsumed debt cannot pass at the deadline',async()=>{
  const {result,elapsed}=await replay({...crossing,target:{x:1.125,z:0},tolerance:.001,timeoutMs:2500},2500);
  assert.equal(result.reached,false);assert.ok(result.distance<=.001);assert.equal(elapsed,2500);
  assert.equal((result as Result&{clock:{pendingSeconds:number}}).clock.pendingSeconds,.5);
});
