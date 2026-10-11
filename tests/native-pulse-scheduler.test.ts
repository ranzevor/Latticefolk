import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {scheduleNativePulse,type NativeKeyCommand,type NativePulseHost,type NativePulseRequest} from '../e2e/helpers/native-pulse-scheduler.js';
import {SimulationClock} from '../src/world/simulationClock.js';
import {nativeInputClock} from './helpers/native-input-clock.js';

function fixture(dispatch?:(command:NativeKeyCommand)=>Promise<unknown>){
  let time=0,id=0;
  const timers=new Map<number,{at:number;callback:()=>void}>(),commands:Array<{at:number;command:NativeKeyCommand}>=[];
  const host:NativePulseHost={now:()=>time,schedule:(callback,delay)=>{timers.set(++id,{at:time+delay,callback});return id;},
    cancel:timer=>{timers.delete(timer as number);},dispatch:command=>{commands.push({at:time,command});return dispatch?.(command)??Promise.resolve();}};
  return {host,timers,commands,async at(next:number){time=next;for(const [key,timer] of [...timers])if(timer.at<=next){timers.delete(key);timer.callback();}await Promise.resolve();await Promise.resolve();}};
}
const request={codes:['KeyD'],durationMs:250,deadlineEpochMs:45_000};

test('native release is sent before a delayed key-down acknowledgement without supplied timestamps',async()=>{
  const acknowledgements:Array<()=>void>=[];
  const f=fixture(()=>new Promise<void>(resolve=>{acknowledgements.push(resolve);}));
  const pending=scheduleNativePulse(request,f.host);
  await f.at(250);
  assert.deepEqual(f.commands.map(c=>[c.at,c.command.type]),[[0,'rawKeyDown'],[250,'keyUp']]);
  assert.ok(f.commands.every(c=>!Object.hasOwn(c.command,'timestamp')));
  await f.at(3000);acknowledgements.forEach(acknowledge=>acknowledge());
  const result=await pending;assert.equal(result.releasedAt,250);assert.ok(result.commands.every(c=>c.confirmedAt===3000));assert.equal(f.timers.size,0);
});
test('native multiple-key pulse releases directions before Shift with consistent modifiers',async()=>{
  const f=fixture(),pending=scheduleNativePulse({...request,codes:['KeyD','ShiftLeft','KeyW']},f.host);
  await f.at(250);const result=await pending;
  assert.deepEqual(result.commands.map(c=>[c.command.type,c.command.code,c.command.modifiers]),[
    ['rawKeyDown','ShiftLeft',8],['rawKeyDown','KeyD',8],['rawKeyDown','KeyW',8],['keyUp','KeyW',8],['keyUp','KeyD',8],['keyUp','ShiftLeft',0]
  ]);assert.equal(f.timers.size,0);
});
test('native dispatch uses the remaining original deadline',async()=>{
  const f=fixture();await f.at(100);
  const pending=scheduleNativePulse({...request,deadlineEpochMs:180},f.host);await f.at(180);
  const result=await pending;assert.equal(result.durationMs,80);assert.equal(result.releasedAt,180);assert.equal(f.timers.size,0);
});
test('expired native request cannot issue new movement',async()=>{
  const f=fixture();await f.at(45_000);const result=await scheduleNativePulse(request,f.host);
  assert.equal(result.skipped,true);assert.equal(f.commands.length,0);assert.equal(f.timers.size,0);
});
for(const change of [{codes:[]},{codes:['KeyD','KeyD']},{codes:['Escape']},{durationMs:0},{durationMs:NaN},{deadlineEpochMs:Infinity}])
test(`invalid native request ${JSON.stringify(change)} issues no key`,async()=>{
  const f=fixture();await assert.rejects(scheduleNativePulse({...request,...change},f.host),/Invalid native pulse/);assert.equal(f.commands.length,0);assert.equal(f.timers.size,0);
});
test('late host release keeps its real dispatch time visible',async()=>{
  const f=fixture(),pending=scheduleNativePulse(request,f.host);await f.at(750);
  const result=await pending;assert.equal(result.durationMs,250);assert.equal(result.releasedAt,750);assert.equal(result.commands[1].issuedAt,750);
});
for(const synchronous of [false,true])test(`${synchronous?'synchronous':'asynchronous'} native key-down failure still issues release`,async()=>{
  const f=fixture(command=>{if(command.type==='rawKeyDown'){if(synchronous)throw Error('down failed');return Promise.reject(Error('down failed'));}return Promise.resolve();});
  const result=await scheduleNativePulse(request,f.host);
  assert.equal(result.commands.length,2);assert.equal(result.commands[1].command.type,'keyUp');assert.equal(result.releasedAt,0);
  assert.match(result.errors[0],/down failed/);assert.equal(f.timers.size,0);
});
test('failed native release remains an error without reporting a successful release acknowledgement',async()=>{
  const f=fixture(command=>command.type==='keyUp'?Promise.reject(Error('up failed')):Promise.resolve());
  const pending=scheduleNativePulse(request,f.host);await f.at(250);const result=await pending;
  assert.match(result.commands[1].error!,/up failed/);assert.equal(result.errors.length,1);assert.equal(f.commands.length,2);
});

const input={right:1,forward:0,sprint:false,directionX:0,directionZ:-1};
for(const [name,down,up,frame,expected] of [
  ['prompt delivery',10,260,16,.25],['batched delivery',3000,3000,undefined,0],['blocked release delivery',10,3000,16,2.99]
] as const)test(`independent dispatch cannot replace actual ${name} consumption boundaries`,()=>{
  const clock=new SimulationClock();let accepted=0;
  const step=(seconds:number,active:typeof input|undefined)=>{if(active)accepted+=seconds;};
  clock.advance(0,step);clock.record(down,input);if(frame!==undefined)clock.advance(frame,step);
  clock.record(up,undefined);clock.advance(up+16,step);while(clock.diagnostics.pendingSeconds>0)clock.advance(up+16,step);
  assert.ok(Math.abs(accepted-expected)<1e-9);assert.equal(clock.diagnostics.pendingSeconds,0);assert.equal(clock.diagnostics.resetReason,'none');
});
test('a historical event timestamp cannot be substituted after an already consumed frame',()=>{
  const clock=new SimulationClock();clock.advance(0,()=>{});clock.record(10,input);clock.advance(1000,()=>{});
  assert.equal(clock.record(260,undefined),false);assert.equal(clock.diagnostics.resetReason,'invalid-time');
});

const source=fs.readFileSync(new URL('../e2e/helpers/native-waypoint.ts',import.meta.url),'utf8');
const callback=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}})
  .outputText.replace('export async function driveNativeWaypoint','async function driveNativeWaypoint')+'\ndriveNativeWaypoint;';
async function probeRoute(options:{releaseDelay?:number;fail?:boolean}={}){
  let x=34,finished=0;const starts:unknown[]=[],pulses:NativePulseRequest[]=[];
  const clock=nativeInputClock({frameMs:500,onStep:(dt,keys)=>{x+=(Number(keys.has('KeyD'))-Number(keys.has('KeyA')))*(keys.has('ShiftLeft')?7.2:4.5)*dt;}});
  const canvas={},dataset=new Proxy({},{get:(_,key)=>key==='playerX'?x.toFixed(4):key==='playerZ'?'0':key==='playerInputSeconds'?String(clock.inputSeconds):key==='simulationClock'?JSON.stringify(clock.clock.diagnostics):'[]'});
  const probe={start:(route:unknown)=>{starts.push(route);},finish:async()=>{finished++;},pulse:async(request:NativePulseRequest)=>{
    pulses.push(request);if(options.fail)throw Error('native dispatch rejected');
    for(const code of request.codes)clock.context.window.dispatchEvent({type:'keydown',code});
    await new Promise<void>(resolve=>clock.context.setTimeout(()=>{
      for(const code of [...request.codes].reverse())clock.context.window.dispatchEvent({type:'keyup',code});resolve();
    },request.durationMs+(options.releaseDelay??0)));
  }};
  const context={...clock.context,performance:{now:()=>clock.time,timeOrigin:100_000},
    window:{nativeInputProbe:probe,dispatchEvent:()=>{throw Error('probe must not synthesize page keyboard input');}},
    document:{pointerLockElement:canvas,querySelector:(selector:string)=>selector==='#game canvas'?canvas:{dataset}}};
  const fn=vm.runInNewContext(callback,context);
  let result:any,error:unknown;
  try{result=await fn({target:{x:40,z:0},timeoutMs:45_000,tolerance:.3,maxInputSeconds:2});}catch(e){error=e;}finally{clock.finish();}
  return {result,error,starts,pulses,finished};
}
test('optional probe preserves the original waypoint target and budgets without page key synthesis',async()=>{
  const r=await probeRoute();assert.equal(r.error,undefined);assert.equal(r.result.reached,true);assert.ok(r.result.distance<=.3);
  assert.ok(r.result.inputSeconds<=2);assert.ok(r.result.elapsedMs<=45_000);assert.equal(r.finished,1);
  assert.deepEqual(JSON.parse(JSON.stringify(r.starts)),[{target:{x:40,z:0},timeoutMs:45_000,tolerance:.3,maxInputSeconds:2,begin:0,deadline:45_000}]);
  assert.ok(r.pulses.every(p=>p.deadlineEpochMs===145_000&&p.durationMs<=250));
});
test('optional probe cannot hide an over-budget actual release',async()=>{
  const r=await probeRoute({releaseDelay:3000});assert.equal(r.error,undefined);assert.equal(r.result.reached,false);
  assert.equal(r.result.stopReason,'input-budget');assert.ok(r.result.inputSeconds>2);assert.equal(r.result.clock.pendingSeconds,0);assert.equal(r.finished,1);
});
test('optional probe reports native dispatch failure and completes diagnostic cleanup',async()=>{
  const r=await probeRoute({fail:true});assert.match(String(r.error),/native dispatch rejected/);assert.equal(r.finished,1);
});

const collectorSource=fs.readFileSync(new URL('../e2e/helpers/native-input-probe.ts',import.meta.url),'utf8');
const syntax=ts.createSourceFile('native-input-probe.ts',collectorSource,ts.ScriptTarget.Latest,true);
let installSource='';
function findInstall(node:ts.Node){
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='addInitScript')installSource=node.arguments[0].getText(syntax);
  ts.forEachChild(node,findInstall);
}
findInstall(syntax);assert.ok(installSource);
const install=ts.transpileModule(`const install=${installSource};install;`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
for(const invalid of [false,true])test(`controlled browser collector retains original event and handler timestamps${invalid?' and rejects untrusted input':''}`,async()=>{
  let time=10,nextId=0;
  const listeners=new Map<string,(event:unknown)=>void>(),frames=new Map<number,(at:number)=>void>(),reports:any[]=[];
  const dataset=Object.freeze({playerX:'34',playerZ:'0',playerInputSeconds:'0',simulationClock:'{"pendingSeconds":0}'});
  const root:any={__latticeNativePulse:async()=>{},__latticeNativeProbeRecord:async(value:unknown)=>{reports.push(value);}};
  const context={window:root,performance:{timeOrigin:1000,now:()=>time},
    document:{querySelector:()=>({dataset}),hasFocus:()=>true,hidden:false},
    addEventListener:(type:string,listener:(event:unknown)=>void)=>{listeners.set(type,listener);},
    requestAnimationFrame:(listener:(at:number)=>void)=>{frames.set(++nextId,listener);return nextId;},cancelAnimationFrame:(id:number)=>{frames.delete(id);}};
  vm.runInNewContext(install,context)();
  root.nativeInputProbe.start({target:{x:40,z:0},timeoutMs:45_000,maxInputSeconds:2});
  time=100;listeners.get('keydown')!(Object.freeze({type:'keydown',code:'KeyD',timeStamp:12.5,isTrusted:!invalid,repeat:false}));
  time=200;listeners.get('keyup')!(Object.freeze({type:'keyup',code:'KeyD',timeStamp:62.5,isTrusted:true,repeat:false}));
  time=210;const [id,frame]=[...frames][0];frames.delete(id);frame(90);
  if(invalid)await assert.rejects(root.nativeInputProbe.finish(),/untrusted input/);else await root.nativeInputProbe.finish();
  const report=reports[0];assert.equal(reports.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(report.keys.map((event:any)=>[event.eventAt,event.handledAt]))),[[12.5,100],[62.5,200]]);
  assert.equal(report.frames[0].rafTimestamp,90);assert.equal(report.frames[0].callbackAt,210);assert.equal(report.final.inputSeconds,0);
  assert.equal(report.startState.x,34);assert.equal(report.held.length,0);assert.equal(frames.size,0);
});
