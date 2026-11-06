import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import {SimulationClock} from '../../src/world/simulationClock.js';
import {FinePhysicsAuthority} from '../../src/world/finePhysics.js';
import {scheduleNativePulse,type NativeKeyCommand} from '../../e2e/helpers/native-pulse-scheduler.js';

const {JSDOM}=createRequire(import.meta.url)('jsdom');
const main=ts.createSourceFile('main.ts',fs.readFileSync(new URL('../../src/main.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const names=new Set(['playerInputAllowed','playerMovementKey','recordPlayerInput','updatePlayer']);
const members:string[]=[],diagnostics:string[]=[];
for(const node of main.statements)if(ts.isClassDeclaration(node)&&node.name?.text==='TownGame')for(const member of node.members){
  if(ts.isMethodDeclaration(member)&&names.has(member.name.getText(main)))members.push(member.getText(main));
  if(ts.isMethodDeclaration(member)&&member.name.getText(main)==='updateUi')for(const statement of member.body!.statements){
    if(ts.isExpressionStatement(statement)&&ts.isBinaryExpression(statement.expression)&&
      ['simulationClock','simulationConsumedThrough','playerX','playerZ','playerInputSeconds'].some(key=>(statement.expression as ts.BinaryExpression).left.getText(main)===`ui.world.dataset.${key}`))diagnostics.push(statement.getText(main));
  }
}
assert.equal(members.length,names.size);assert.equal(diagnostics.length,5);
const runtimeCode=ts.transpileModule(`return class Runtime {${members.join('\n')}\nupdateUi(){${diagnostics.join('\n')}}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const probe=ts.createSourceFile('probe.ts',fs.readFileSync(new URL('../../e2e/helpers/native-input-probe.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
let init:ts.Expression|undefined;
(function visit(node:ts.Node){if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='addInitScript')init=node.arguments[0];ts.forEachChild(node,visit);})(probe);
assert.ok(init);
const probeCode=ts.transpileModule(`(${init.getText(probe)})();`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;

export interface ReleasedRuntimeOptions {
  frameMs?:number;delivery?:'historical';keyUpAckMs?:number;releaseAfterHudMs?:number;
  repeatAfterHudMs?:number;repeatAtMs?:number;noHudAfterRelease?:boolean;
  pulseError?:Error;finishError?:Error;registrationError?:Error;registrationFailure?:'observer'|'keydown'|'keyup'|'timer'|'raf';rafFailureAt?:number;
}

export function releasedInputRuntime(options:ReleasedRuntimeOptions={}){
  let armed=false;
  let time=10_000,id=0,nextFrame=time,active=true,pump:ReturnType<typeof setImmediate>|undefined,record:any,finishCalls=0,rafCalls=0;
  const frames=new Map<number,(at:number)=>void>(),timers=new Map<number,{at:number;fn:()=>void}>(),events=new Map<number,{at:number;fn:()=>void}>();
  const listeners=new Map<string,Set<(event:any)=>void>>(),observers=new Set<unknown>(),history:any[]=[],pulses:any[]=[],commands:any[]=[],deferred:Array<{at:number;fn:()=>void}>=[];
  const dom=new JSDOM('<div id="game"><canvas></canvas></div><div id="worldStatus"></div>');
  const world=dom.window.document.querySelector('#worldStatus') as HTMLElement,canvas=dom.window.document.querySelector('canvas');
  Object.assign(world.dataset,{wildlifeVisuals:'[]',characterSoles:'[]'});
  const document={pointerLockElement:canvas,hidden:false,activeElement:null,hasFocus:()=>true,querySelector:(selector:string)=>selector==='#game canvas'?canvas:world};
  const addEventListener=(type:string,fn:(event:any)=>void)=>{const set=listeners.get(type)??new Set();set.add(fn);listeners.set(type,set);if(armed&&options.registrationFailure===type)throw options.registrationError;};
  const removeEventListener=(type:string,fn:(event:any)=>void)=>listeners.get(type)?.delete(fn);
  const emit=(type:string,code:string,eventAt:number)=>{const event={type,code,timeStamp:eventAt,isTrusted:true,repeat:false};for(const fn of [...listeners.get(type)??[]])fn(event);};
  const queue=(at:number,fn:()=>void)=>{events.set(++id,{at,fn});schedule();};
  const requestAnimationFrame=(fn:(at:number)=>void)=>{rafCalls++;if(armed&&(options.registrationFailure==='raf'||rafCalls===options.rafFailureAt))throw options.registrationError;frames.set(++id,fn);schedule();return id;};
  const setTimeout=(fn:()=>void,delay:number)=>{timers.set(++id,{at:time+delay,fn});if(armed&&options.registrationFailure==='timer'){timers.delete(id);throw options.registrationError;}schedule();return id;};
  function schedule(){if(pump||!active)return;pump=setImmediate(()=>{pump=undefined;
    const next=Math.min(frames.size?nextFrame:Infinity,...[...timers.values()].map(t=>t.at),...[...events.values()].map(e=>e.at));if(!Number.isFinite(next))return;
    time=Math.max(time,next);
    for(const [key,event] of [...events])if(event.at<=time){events.delete(key);event.fn();}
    for(const [key,timer] of [...timers])if(timer.at<=time){timers.delete(key);timer.fn();}
    if(frames.size&&nextFrame<=time){nextFrame=time+(options.frameMs??50);const callbacks=[...frames.values()];frames.clear();for(const fn of callbacks)fn(time);}
    if(frames.size||timers.size||events.size)schedule();
  });}
  const root:any={async __latticeNativePulse(request:any){
    const issuedAt=time,leg=pulses.length+1;pulses.push({...request,issuedAt,priorInputSeconds:runtime.playerInputSeconds,priorQueue:runtime.simulationClock.pendingInputChanges});
    if(options.repeatAtMs!==undefined)queue(issuedAt+options.repeatAtMs,()=>{for(const code of request.codes)emit('keyup',code,issuedAt+request.durationMs);});
    const result=await scheduleNativePulse(request,{now:()=>time+10_000,schedule:setTimeout,cancel:key=>timers.delete(key as number),dispatch:(command:NativeKeyCommand)=>new Promise<void>(resolve=>{
      const issued=time,handledAt=options.delivery?issuedAt+300:issued;commands.push({leg,...command,issuedAt:issued,handledAt});
      const deliver=()=>{emit(command.type==='keyUp'?'keyup':'keydown',command.code,options.delivery==='historical'?issued:time);
        if(command.type==='keyUp'&&options.keyUpAckMs!==undefined)queue(issuedAt+options.keyUpAckMs,resolve);else resolve();};
      if(command.type==='keyUp'&&options.releaseAfterHudMs!==undefined)deferred.push({at:issuedAt+options.releaseAfterHudMs,fn:deliver});else queue(handledAt,deliver);
    })});
    Object.assign(pulses.at(-1),{returnedAt:time,hudAtReturn:JSON.parse(world.dataset.simulationClock!),queueAtReturn:runtime.simulationClock.pendingInputChanges});
    if(options.pulseError)throw options.pulseError;return result;
  },async __latticeNativeProbeRecord(value:any){finishCalls++;record=value;if(options.finishError)throw options.finishError;}};
  const context={window:root,document,performance:{now:()=>time,timeOrigin:10_000},addEventListener,removeEventListener,requestAnimationFrame,cancelAnimationFrame:(key:number)=>frames.delete(key),setTimeout,clearTimeout:(key:number)=>timers.delete(key),
    MouseEvent:class{type:string;constructor(type:string){this.type=type;}},
    MutationObserver:class{observer:any;constructor(fn:MutationCallback){this.observer=new dom.window.MutationObserver(fn);}observe(target:any,settings:any){this.observer.observe(target,settings);observers.add(this);if(options.registrationFailure==='observer')throw options.registrationError;}takeRecords(){return this.observer.takeRecords();}disconnect(){this.observer.disconnect();observers.delete(this);}}};
  vm.runInNewContext(probeCode,context);
  const ui={world,admin:{classList:{contains:()=>true}},overlay:{classList:{contains:()=>true}}};
  const Runtime=new Function('THREE','now','document','ui',runtimeCode)(THREE,()=>time,document,ui),runtime=new Runtime(),physics=new FinePhysicsAuthority(),camera=new THREE.PerspectiveCamera();
  const start={x:0,z:0};camera.position.set(start.x,1.7,start.z);
  Object.assign(runtime,{camera,physics,keys:new Set<string>(),simulationClock:new SimulationClock(),persistenceReady:true,cameraMode:'firstPerson',interactionOpen:false,controls:{isLocked:true},playerPosition:{...start},firstPersonRotation:new THREE.Euler(),playerInputSeconds:0,npcs:new Map(),playerBlockedNpcs:new Set(),physicsDynamicColliders:()=>[],groundHeightAt:()=>0,resetPlayerInput(){throw Error('Unexpected input reset');}});
  canvas.dispatchEvent=(event:{movementX:number})=>{camera.rotation.y-=event.movementX*.002;return true;};
  addEventListener('keydown',e=>runtime.playerMovementKey(e.code,true,e.repeat,e.timeStamp));addEventListener('keyup',e=>runtime.playerMovementKey(e.code,false,false,e.timeStamp));
  const baselineListeners=[...listeners.values()].reduce((sum,set)=>sum+set.size,0);
  runtime.simulationClock.advance(time,()=>{});runtime.updateUi();
  let lastReleaseAt=Infinity;
  const releaseListener=()=>{lastReleaseAt=Math.min(lastReleaseAt,time);};addEventListener('keyup',releaseListener);
  const render=(at:number)=>{
    requestAnimationFrame(render);
    assert.equal(runtime.simulationClock.advanceFrame(at,time,(dt:number,input:any)=>runtime.updatePlayer(dt,input??{forward:0,right:0,sprint:false,directionX:0,directionZ:-1})),true);
    if(!options.noHudAfterRelease||time<=lastReleaseAt)runtime.updateUi();
    for(const release of [...deferred])if(release.at<=time){deferred.splice(deferred.indexOf(release),1);release.fn();}
    const pulse=pulses.at(-1);if(pulse&&options.repeatAfterHudMs!==undefined&&time===pulse.issuedAt+options.repeatAfterHudMs)queueMicrotask(()=>{for(const code of pulse.codes)emit('keyup',code,pulse.issuedAt+pulse.durationMs);});
    history.push({at:time,consumed:runtime.simulationClock.consumedThroughMs,pending:runtime.simulationClock.diagnostics.pendingSeconds,queue:runtime.simulationClock.pendingInputChanges,input:runtime.playerInputSeconds,x:runtime.playerPosition.x,z:runtime.playerPosition.z});
  };
  requestAnimationFrame(render);armed=true;
  return {context,world,runtime,history,pulses,commands,queue,emit,get time(){return time;},get record(){return record;},get finishCalls(){return finishCalls;},
    close({probeUsed=false}:{probeUsed?:boolean}={}){
      active=false;if(pump)clearImmediate(pump);removeEventListener('keyup',releaseListener);
      assert.equal(observers.size,0);assert.equal([...listeners.values()].reduce((sum,set)=>sum+set.size,0),baselineListeners);
      assert.equal(timers.size,0);assert.equal(frames.size,1,'only the application frame loop remains');assert.equal(runtime.keys.size,0);
      if(probeUsed){assert.equal(finishCalls,1);assert.equal(record.held.length,0);}frames.clear();events.clear();dom.window.close();
    }};
}
