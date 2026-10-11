import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import ts from 'typescript';
import {nativeInputClock} from './helpers/native-input-clock.js';
import {FinePhysicsAuthority,type PhysicsPoint} from '../src/world/finePhysics.js';
import {registerHomeTerrain} from '../src/world/fineTerrain.js';
import {characterHeadEnvelope,playerHeadConstraint,playerHeadClearance} from '../src/world/characterContact.js';
import {stepNpcYield} from '../src/world/npcYield.js';

type Point=PhysicsPoint;
type Pose={id:string;asset:string;position:Point;yaw:number};
type Result={reached:boolean;x:number;z:number;distance:number;detours:number;history:Array<{phase:string;x:number;z:number;elapsedMs:number}>};
const source=fs.readFileSync(new URL('../e2e/helpers/native-waypoint.ts',import.meta.url),'utf8');
const callback=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace('export async function driveNativeWaypoint','async function driveNativeWaypoint')+'\ndriveNativeWaypoint;';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/native-waypoint-progress-ci.json',import.meta.url),'utf8'));

// A small callback contract harness. Optional synthetic observations test the
// progress detector; only the contact fixtures below claim production physics.
async function drive(options:{start:Point;target:Point;wallMs:number;simulationDt?:number;timeoutMs?:number;tolerance?:number;zeroFrames?:number;observed?:(simulation:number,frame:number)=>unknown;
  pose?:(frame:number,p:Point,keys:Set<string>,dt:number)=>Point;actors?:Pose[];stopOnRecovery?:boolean}){
 let p={...options.start},wall=0,simulation=0,frames=0;
 const held=new Set<string>(),events:Array<{frame:number;type:string;code:string}>=[],poses:Array<{p:Point;keys:string[];simulation:number}>=[];
 const canvas={},physics=new FinePhysicsAuthority();registerHomeTerrain(physics,72);
 const dataset=new Proxy({},{get:(_,key)=>key==='playerX'?p.x.toFixed(4):key==='playerZ'?p.z.toFixed(4):key==='simulationClock'?JSON.stringify(clock.clock.diagnostics):key==='playerInputSeconds'?(options.observed?options.observed(simulation,frames):String(simulation)):key==='treePresentation'?'[]':key==='characterSoles'?JSON.stringify((options.actors??[]).map(a=>({...a,headYaw:a.yaw,headEnvelope:characterHeadEnvelope(a.asset)}))):undefined,set:()=>{throw new Error('no diagnostic writes');}});
 let steps=0;
 const clock=nativeInputClock({frameMs:options.wallMs,onFrame:()=>{frames++;wall=frames*options.wallMs;},onStep:(seconds,active)=>{
  const dt=frames<=(options.zeroFrames??0)?0:seconds*(options.simulationDt===undefined?1:options.simulationDt/.05);simulation+=dt;steps++;
  if(options.stopOnRecovery&&steps>1&&(!active.has('KeyD')||!active.has('KeyW')))throw new Error('recovery selected; uncaptured future path deliberately not simulated');
  const dx=Number(active.has('KeyD'))-Number(active.has('KeyA')),dz=Number(active.has('KeyS'))-Number(active.has('KeyW')),length=Math.hypot(dx,dz);
  if(options.pose)p=options.pose(steps,p,active,dt);
  else if(length){const d=(active.has('ShiftLeft')?7.2:4.5)*dt;p=physics.moveKinematic({id:'player',position:p,radius:.3,displacement:{x:dx/length*d,z:dz/length*d},dynamic:(options.actors??[]).map(a=>({id:a.id,...a.position,radius:.32})),constraints:(options.actors??[]).map(a=>playerHeadConstraint(a.id,a.asset,a.position,a.yaw))}).position;}
  poses.push({p:{...p},keys:[...active],simulation});
 }});
 const context={...clock.context,document:{pointerLockElement:canvas,querySelector:(s:string)=>s==='#game canvas'?canvas:{dataset}}};

 let result:Result|undefined,error:unknown;
 try{result=await vm.runInNewContext(callback,context)({target:options.target,timeoutMs:options.timeoutMs??45000,tolerance:options.tolerance??.55});}catch(e){error=e;}
 clock.finish();return {result,error,frames,poses,events:clock.events,simulation,wall:clock.time};
}

for(const wallMs of [16,100,1000,1600])test(`unobstructed ${wallMs}ms frames retain real simulated progress`,async()=>{
 const r=await drive({start:{x:0,z:0},target:{x:5,z:0},wallMs});assert.equal(r.result?.reached,true);assert.equal(r.result.detours,0);assert.ok(r.wall<=45000);
});
test('slow actual simulation is not charged wall-clock movement',async()=>{
 const r=await drive({start:{x:0,z:0},target:{x:.6,z:0},wallMs:1600,simulationDt:.005,tolerance:.12});assert.equal(r.result?.reached,true);assert.equal(r.result.detours,0);
});
test('initial sampling and zero simulation steps cannot start recovery',async()=>{
 const r=await drive({start:{x:0,z:0},target:{x:2,z:0},wallMs:100,zeroFrames:8});assert.equal(r.result?.reached,true);assert.equal(r.result.detours,0);
});
test('already accepted goal issues no input',async()=>{
 const r=await drive({start:{x:0,z:0},target:{x:.1,z:0},wallMs:1600});assert.equal(r.result?.reached,true);assert.equal(r.frames,0);assert.equal(r.events.length,0);
});
test('ordinary sprint-to-walk braking is useful progress',async()=>{
 const r=await drive({start:{x:0,z:0},target:{x:1.95,z:.1},wallMs:1600,tolerance:.28});assert.equal(r.result?.reached,true);assert.equal(r.result.detours,0);
});
for(const kind of ['jitter','circle'] as const)test(`${kind} cannot reset recovery indefinitely`,async()=>{
 const r=await drive({start:{x:-3,z:0},target:{x:3,z:0},wallMs:100,timeoutMs:1200,tolerance:.2,
  pose:(frame)=>kind==='jitter'?{x:-3+(frame%2?.08:0),z:0}:{x:3-6*Math.cos(frame*.04),z:6*Math.sin(frame*.04)}});
 assert.equal(r.result?.reached,false);assert.ok(r.result.detours>=1);assert.ok(r.result.history.some(h=>h.phase==='slow-progress'));assert.ok(r.result.detours<=3);
});
for(const wallMs of [100,1600])test(`legitimate sideward detour advances its waypoint at ${wallMs}ms`,async()=>{
 const r=await drive({start:{x:-3,z:0},target:{x:3,z:0},wallMs,actors:[{id:'obstacle',asset:'female2',position:{x:0,z:0},yaw:0}]});
 assert.equal(r.result?.reached,true);assert.equal(r.result.detours,1);assert.equal(r.result.history.filter(h=>h.phase==='slow-progress').length,0);
});

function contactWorld(){
 const f=structuredClone(fixture),actors=f.actors as Pose[],npc=actors.find(a=>a.id===f.yieldingActorId)!;
 const physics=new FinePhysicsAuthority();registerHomeTerrain(physics,72);for(const s of f.statics)physics.registerStatic(s);
 let p={...f.player},plan=f.inferredYieldPlan;const rows:Array<{p:Point;hits:string[];distance:number}>=[];
 return {actors,rows,step:(keys:Set<string>,dt:number)=>{
  const dx=Number(keys.has('KeyD'))-Number(keys.has('KeyA')),dz=Number(keys.has('KeyS'))-Number(keys.has('KeyW')),len=Math.hypot(dx,dz);assert.ok(len>0);
  const speed=(keys.has('ShiftLeft')?7.2:4.5)*dt,travel={x:dx/len*speed,z:dz/len*speed};
  const resolved=physics.moveKinematic({id:'player',position:p,radius:.3,displacement:travel,dynamic:[f.cart,...actors.map(a=>({id:'npc:'+a.id,...a.position,radius:.32}))],constraints:actors.map(a=>playerHeadConstraint('npc:'+a.id,a.asset,a.position,a.yaw))});p=resolved.position;
  const yielding=stepNpcYield(physics,{id:'npc:'+npc.id,asset:npc.asset,position:npc.position,yaw:npc.yaw,player:p,travel,activePath:true,blockedPlayer:resolved.dynamicHits.includes('npc:'+npc.id),plan,dt,dynamic:[f.cart,{id:'player',...p,radius:.3},...actors.filter(a=>a.id!==npc.id).map(a=>({id:'npc:'+a.id,...a.position,radius:.32}))]});
  assert.ok(yielding,'uncaptured ordinary NPC path is outside this fixture');npc.position=yielding.position;plan=yielding.plan;
  assert.ok(playerHeadClearance(npc.asset,npc.position,npc.yaw,p)>=-1e-8);rows.push({p:{...p},hits:resolved.dynamicHits,distance:Math.hypot(p.x-f.target.x,p.z-f.target.z)});return p;
 },read:()=>({p,npc})};
}
test('captured ten-frame contact exactly matches both observed endpoints',()=>{
 const w=contactWorld();for(let i=0;i<10;i++)w.step(new Set(fixture.keys),fixture.dt);
 assert.deepEqual(w.read().p,fixture.expected.player);assert.deepEqual(w.read().npc.position,fixture.expected.nao);
 assert.ok(w.rows.every(r=>r.hits.includes('npc:nao')));
});
for(const wallMs of [100,1600])test(`captured partial contact selects recovery promptly at ${wallMs}ms`,async()=>{
 const w=contactWorld();const r=await drive({start:fixture.player,target:fixture.target,wallMs,tolerance:fixture.tolerance,actors:w.actors,
  pose:(_i,_p,keys,dt)=>w.step(keys,dt),stopOnRecovery:true});
 assert.match(String(r.error),/recovery selected/);assert.ok(w.rows.length>=3&&w.rows.length<=6,`applied frames ${w.rows.length}`);
 assert.ok(w.rows.every(r=>r.hits.includes('npc:nao')));assert.ok(r.events.some(e=>e.type==='keyup'&&e.code==='KeyW'));
});

for(const bad of [undefined,'','  ','NaN','Infinity','-Infinity','-1','unknown'])test(`invalid initial simulation diagnostic ${String(bad)} is rejected`,async()=>{
 const r=await drive({start:{x:0,z:0},target:{x:3,z:0},wallMs:100,observed:()=>bad});assert.match(String(r.error),/simulation observation/);assert.equal(r.events.length,0);
});
for(const bad of ['NaN','Infinity','0'])test(`invalid or reset active simulation diagnostic ${bad} releases keys`,async()=>{
 const r=await drive({start:{x:0,z:0},target:{x:3,z:0},wallMs:100,observed:(s,frame)=>frame>=2?bad:String(s)});assert.match(String(r.error),/simulation observation reset|without observed direction input/);assert.ok(r.events.some(e=>e.type==='keydown'));assert.ok(r.events.some(e=>e.type==='keyup'));
});
test('wall timeout with no real input steps stays false without planning',async()=>{
 const r=await drive({start:{x:0,z:0},target:{x:3,z:0},wallMs:1600,simulationDt:0});assert.equal(r.result?.reached,false);assert.equal(r.result.detours,0);assert.equal(r.simulation,0);
});
test('same simulated input under different wall cadence selects identical actions',async()=>{
 const a=await drive({start:{x:0,z:0},target:{x:5,z:.3},wallMs:100,simulationDt:.05});
 const b=await drive({start:{x:0,z:0},target:{x:5,z:.3},wallMs:1600,simulationDt:.05});
 assert.equal(a.result?.reached,true);assert.equal(b.result?.reached,true);assert.deepEqual(a.poses,b.poses);assert.deepEqual(a.events.map(({type,code})=>({type,code})),b.events.map(({type,code})=>({type,code})));
});
test('small real input steps are not mistaken for four blocked frames',async()=>{
 const r=await drive({start:{x:0,z:0},target:{x:.2,z:0},wallMs:100,simulationDt:.001,tolerance:.01});assert.equal(r.result?.reached,true);assert.equal(r.result.detours,0);
});

test('a missing final observation cannot be accepted at the wall deadline',async()=>{
 const r=await drive({start:{x:0,z:0},target:{x:.3,z:0},wallMs:100,timeoutMs:100,tolerance:.1,observed:(s,frame)=>frame?'NaN':String(s)});
 assert.match(String(r.error),/simulation observation/);assert.ok(r.events.some(e=>e.type==='keyup'));
});


test('sustained rendering beyond the advance budget leaves debt visible at the original deadline',async()=>{
 const r=await drive({start:{x:0,z:0},target:{x:5,z:0},wallMs:2500});
 assert.equal(r.result?.reached,false);assert.equal(r.wall,45000);assert.equal(r.result?.detours,0);
 assert.ok(r.simulation>0);assert.ok(r.events.every(e=>e.at<=250));
});
