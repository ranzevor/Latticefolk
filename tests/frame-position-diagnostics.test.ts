import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {afterEach,beforeEach,test} from 'node:test';
import vm from 'node:vm';
import type {Page} from '@playwright/test';
import {getPlayerZWaitDiagnostics,observePlayerZ,waitForPlayerZBelow} from '../e2e/helpers/frame-position.js';

type Input=Parameters<typeof observePlayerZ>[0];
type Frame={at:number;x?:string;z?:string;input?:string;origin?:number;npcs?:string;consoleFails?:boolean;late?:boolean};
const trace=():Input['trace']=>({polls:0,sequence:0,dropped:0,firstPollAt:null,lastFlushAt:null,firstReached:null,pending:[]});
const timeoutError=()=>Object.freeze(new Error('Timeout 20000ms exceeded.'));
const quiet=async<T>(run:()=>Promise<T>)=>{const old=console.error;console.error=()=>{};try{return await run();}finally{console.error=old;}};
const originalInfo=console.info;
beforeEach(()=>{console.info=()=>{};});
afterEach(()=>{console.info=originalInfo;});

class ControlledPage extends EventEmitter {
  calls:Array<{timeout:number;polling:string}>=[];
  disposed=0;reads=0;invocations=0;late:Array<()=>void>=[];dataSnapshots:string[]=[];
  forceError?:Error;readError?:Error;disposeError?:Error;throwOnListener=false;
  beforeDelivery?:()=>Promise<void>;
  frames:Frame[];
  constructor(frames:Frame[]){super();this.frames=frames;}
  asPage(){return this as unknown as Page;}
  override on(event:string,listener:(...args:any[])=>void){if(this.throwOnListener)throw new Error('listener failed');return super.on(event,listener);}
  override off(event:string,listener:(...args:any[])=>void){super.off(event,listener);if(this.throwOnListener)throw new Error('remove failed');return this;}
  async waitForFunction(predicate:typeof observePlayerZ,input:Input,options:{timeout:number;polling:string}){
    this.calls.push({...options});
    let state=structuredClone(input),lastOrigin:number|undefined;
    let result:ReturnType<typeof observePlayerZ>=false;
    for(const frame of this.frames){
      if(lastOrigin!==undefined&&lastOrigin!==(frame.origin??1000))state=structuredClone(input);
      lastOrigin=frame.origin??1000;
      const dataset=Object.freeze({playerX:frame.x??'-10',playerZ:frame.z??'-9.8',playerInputSeconds:frame.input??'0',
        cameraMode:'firstPerson',cameraYaw:'0.000000',playerBodyPresent:'true',characterSoles:frame.npcs??'[]'});
      const before=JSON.stringify(dataset);this.dataSnapshots.push(before);
      const run=vm.runInNewContext('('+predicate.toString()+')',{
        document:Object.freeze({querySelector:()=>Object.freeze({dataset})}),
        performance:{now:()=>frame.at,timeOrigin:lastOrigin},
        console:{debug:(text:string)=>{if(frame.consoleFails)throw new Error('console failed');
          const send=()=>this.emit('console',{text:()=>text});if(frame.late)this.late.push(send);else send();}}
      }) as typeof observePlayerZ;
      this.invocations++;result=run(state);assert.equal(JSON.stringify(dataset),before);
      // This controller models the original Playwright verdict independently of diagnostics.
      if(result)break;
    }
    if(this.forceError)throw this.forceError;
    if(!result)throw timeoutError();
    await this.beforeDelivery?.();
    return {jsonValue:async()=>{this.reads++;if(this.readError)throw this.readError;return result;},
      dispose:async()=>{this.disposed++;if(this.disposeError)throw this.disposeError;}};
  }
}

test('unchanged strict finite-coordinate predicate, timestamp and output keys',async()=>{
  for(const [x,z,pass] of [['-10','-12',true],['-10','-11',false],['bad','-12',false],['Infinity','-12',false],['-10','NaN',false],['','-12',true]] as const){
    const page=new ControlledPage([{at:123,x,z}]);
    await quiet(async()=>{
      if(pass){const result=await waitForPlayerZBelow(page.asPage(),-11);assert.deepEqual({...result},{x:Number(x),z:Number(z),observedAt:123});}
      else await assert.rejects(waitForPlayerZBelow(page.asPage(),-11),/Timeout/);
    });
    assert.deepEqual(page.calls,[{timeout:20000,polling:'raf'}]);assert.equal(page.listenerCount('console'),0);
  }
});

test('in-deadline passing poll retains success even when result delivery is deferred',async()=>{
  const page=new ControlledPage([{at:10,z:'-10'},{at:19999,z:'-12',input:'.7'}]);
  let deliver!:()=>void;let deliveryPending=false;
  page.beforeDelivery=()=>new Promise<void>(resolve=>{deliveryPending=true;deliver=resolve;});
  const pending=waitForPlayerZBelow(page.asPage(),-11);
  await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(deliveryPending,true);
  // Transport can deliver a server-resolved handle later; it does not change the original verdict.
  deliver();const result=await pending;assert.ok(result);
  assert.equal(result.observedAt,19999);assert.equal(getPlayerZWaitDiagnostics(result)?.firstReached?.observedAt,19999);
  assert.equal(page.disposed,1);assert.equal(page.reads,1);
});

test('late passing observation cannot turn the original timeout into success',async()=>{
  const page=new ControlledPage([{at:1,z:'-10'},{at:20001,z:'-12'}]);const failure=timeoutError();page.forceError=failure;
  await quiet(()=>assert.rejects(waitForPlayerZBelow(page.asPage(),-11),error=>error===failure));
  const report=getPlayerZWaitDiagnostics(failure)!;assert.equal(report.outcome,'rejected');assert.equal(report.firstReached?.observedAt,20001);
  assert.equal(page.reads,0);assert.equal(page.disposed,0);assert.equal(page.listenerCount('console'),0);
});

test('even an early passing observation never overrides a server timeout or cancellation',async()=>{
  const page=new ControlledPage([{at:100,z:'-12'}]);const failure=timeoutError();page.forceError=failure;
  await quiet(()=>assert.rejects(waitForPlayerZBelow(page.asPage(),-11),error=>error===failure));
  assert.equal(getPlayerZWaitDiagnostics(failure)?.firstReached?.observedAt,100);
});

test('real blocking remains a failure while attempted input progresses',async()=>{
  const page=new ControlledPage([{at:0,input:'0'},{at:6000,input:'.15'},{at:19999,input:'.5'}]);
  let failure:Error|undefined;
  await quiet(()=>assert.rejects(waitForPlayerZBelow(page.asPage(),-11),error=>{failure=error as Error;return true;}));
  const report=getPlayerZWaitDiagnostics(failure!)!;
  assert.equal(report.firstReached,null);assert.equal(report.lastSample?.z,-9.8);assert.equal(report.lastSample?.inputSeconds,.5);
  assert.match(report.coverage,/may be missing/);assert.equal(page.invocations,3);
});

for(const message of ['Target page, context or browser has been closed','Test was interrupted','Navigation destroyed the execution context']){
  test(`original error identity survives: ${message}`,async()=>{
    const page=new ControlledPage([{at:0}]);const failure=Object.freeze(new Error(message));page.forceError=failure;
    await quiet(()=>assert.rejects(waitForPlayerZBelow(page.asPage(),-11),error=>error===failure));
    assert.equal(getPlayerZWaitDiagnostics(failure)?.outcome,'rejected');assert.equal(page.listenerCount('console'),0);
    assert.equal(page.reads,0);assert.equal(page.disposed,0);
  });
}

test('jsonValue page closure keeps original cleanup and failure',async()=>{
  const page=new ControlledPage([{at:0,z:'-12'}]);const failure=new Error('page closed during result delivery');page.readError=failure;
  await quiet(()=>assert.rejects(waitForPlayerZBelow(page.asPage(),-11),error=>error===failure));
  assert.equal(page.disposed,1);assert.equal(getPlayerZWaitDiagnostics(failure)?.outcome,'rejected');
});

test('dispose failure is still rejected and diagnostics reflect that outcome',async()=>{
  const page=new ControlledPage([{at:0,z:'-12'}]);const failure=new Error('dispose failed');page.disposeError=failure;
  await quiet(()=>assert.rejects(waitForPlayerZBelow(page.asPage(),-11),error=>error===failure));
  assert.equal(page.disposed,1);assert.equal(getPlayerZWaitDiagnostics(failure)?.outcome,'rejected');
});

test('console transport or optional NPC JSON failure cannot change a passing result',async()=>{
  for(const npcs of ['{bad','null',JSON.stringify(Array(65).fill({})),JSON.stringify([{id:'ren',position:{x:-10,z:-11},playerHeadClearance:.02}]),'x'.repeat(9000)]){
    for(const consoleFails of [false,true]){
      const page=new ControlledPage([{at:42,z:'-12',npcs,consoleFails}]);
      const result=await waitForPlayerZBelow(page.asPage(),-11);assert.ok(result);assert.equal(result.observedAt,42);assert.equal(page.disposed,1);
    }
  }
});

test('diagnostic listener failures do not replace the original wait or failure',async()=>{
  const page=new ControlledPage([{at:0,z:'-12'}]);page.throwOnListener=true;
  const result=await waitForPlayerZBelow(page.asPage(),-11);assert.ok(result);assert.equal(result.z,-12);
  const blocked=new ControlledPage([{at:0}]);blocked.throwOnListener=true;const original=timeoutError();blocked.forceError=original;
  await quiet(()=>assert.rejects(waitForPlayerZBelow(blocked.asPage(),-11),error=>error===original));
});

test('timeline and parsing are bounded, with first sample and first reach retained',async()=>{
  const frames=Array.from({length:500},(_,i)=>({at:i*16,z:i===499?'-12':'-10',input:String(i*.001)}));
  const page=new ControlledPage(frames);const result=await waitForPlayerZBelow(page.asPage(),-11);assert.ok(result);
  const report=getPlayerZWaitDiagnostics(result)!;
  assert.equal(report.receivedSamples,500);assert.equal(report.timeline.length,128);assert.equal(report.evictedSamples,372);
  assert.equal(report.firstSample?.poll,1);assert.equal(report.firstReached?.poll,500);assert.equal(report.lastSample?.poll,500);
  assert.ok(report.epochs[0].lastSequence<40,'batching must not log every fast frame');
});

test('navigation epochs are explicit rather than comparing performance.now across documents',async()=>{
  const page=new ControlledPage([{at:900,origin:1000},{at:50,origin:2000},{at:100,origin:2000,z:'-12'}]);
  const result=await waitForPlayerZBelow(page.asPage(),-11);assert.ok(result);const report=getPlayerZWaitDiagnostics(result)!;
  assert.deepEqual(report.epochs.map(epoch=>epoch.timeOrigin),[1000,2000]);assert.equal(report.firstReached?.timeOrigin,2000);
});

test('late console delivery after rejection is ignored and cannot revise diagnostics',async()=>{
  const page=new ControlledPage([{at:0},{at:20001,z:'-12',late:true}]);const failure=timeoutError();page.forceError=failure;
  await quiet(()=>assert.rejects(waitForPlayerZBelow(page.asPage(),-11),error=>error===failure));
  const report=getPlayerZWaitDiagnostics(failure)!;const before=JSON.stringify(report);
  page.late.forEach(deliver=>deliver());assert.equal(JSON.stringify(report),before);assert.equal(report.firstReached,null);
});

test('two concurrent waits use separate tokens and listeners',async()=>{
  const first=new ControlledPage([{at:1,z:'-12'}]);const second=new ControlledPage([{at:2,z:'-13'}]);
  const [a,b]=await Promise.all([waitForPlayerZBelow(first.asPage(),-11),waitForPlayerZBelow(second.asPage(),-12)]);
  assert.ok(a);assert.ok(b);
  assert.notEqual(getPlayerZWaitDiagnostics(a)?.token,getPlayerZWaitDiagnostics(b)?.token);
  assert.equal(getPlayerZWaitDiagnostics(a)?.lastSample?.z,-12);assert.equal(getPlayerZWaitDiagnostics(b)?.lastSample?.z,-13);
});

test('browser-side buffer stays bounded even when its clock does not advance',()=>{
  const input:Input={maxZ:-11,token:'test',trace:trace()};const frames=300;const packets:string[]=[];
  const run=vm.runInNewContext('('+observePlayerZ.toString()+')',{
    document:{querySelector:()=>({dataset:{playerX:'-10',playerZ:'-10'}})},
    performance:{now:()=>0,timeOrigin:1},console:{debug:(packet:string)=>packets.push(packet)}
  }) as typeof observePlayerZ;
  for(let i=0;i<frames;i++)assert.equal(run(input),false);
  assert.equal(input.trace.pending.length,64);assert.equal(input.trace.dropped,235);assert.equal(packets.length,1);
});

test('invalid player coordinates do not label arbitrary actors as nearby',async()=>{
  const page=new ControlledPage([{at:0,x:'NaN',npcs:'[{"id":"far","position":{"x":500,"z":500}}]'}]);
  const failure=timeoutError();page.forceError=failure;
  await quiet(()=>assert.rejects(waitForPlayerZBelow(page.asPage(),-11),error=>error===failure));
  assert.deepEqual(getPlayerZWaitDiagnostics(failure)?.lastSample?.nearby,[]);
});

test('success stdout retains the bounded received timeline without another browser operation',async()=>{
  const output:string[]=[];console.info=(line:string)=>output.push(line);
  const page=new ControlledPage([{at:1,z:'-10'},{at:500,z:'-12',input:'.7'}]);
  const result=await waitForPlayerZBelow(page.asPage(),-11);assert.ok(result);
  assert.equal(output.length,1);const record=JSON.parse(output[0].slice('[player-z-wait] '.length));
  assert.equal(record.outcome,'resolved');assert.equal(record.firstReached.observedAt,500);
  assert.equal(record.timeline.length,2);assert.match(record.coverage,/unflushed or late samples may be missing/);
  assert.deepEqual(page.calls,[{timeout:20000,polling:'raf'}]);assert.equal(page.reads,1);assert.equal(page.disposed,1);
});

test('success still logs explicit missing samples when console batches were unavailable',async()=>{
  const output:string[]=[];console.info=(line:string)=>output.push(line);
  const page=new ControlledPage([{at:1,z:'-12',consoleFails:true}]);const result=await waitForPlayerZBelow(page.asPage(),-11);assert.ok(result);
  const record=JSON.parse(output[0].slice('[player-z-wait] '.length));
  assert.equal(record.outcome,'resolved');assert.equal(record.firstReached,null);assert.equal(record.receivedSamples,0);
  assert.deepEqual(record.timeline,[]);assert.match(record.coverage,/may be missing/);
});

test('a failing stdout sink does not replace an original success',async()=>{
  console.info=()=>{throw new Error('stdout unavailable');};
  const page=new ControlledPage([{at:1,z:'-12'}]);const result=await waitForPlayerZBelow(page.asPage(),-11);assert.ok(result);
  assert.equal(result.z,-12);assert.equal(page.disposed,1);assert.equal(page.listenerCount('console'),0);
});
