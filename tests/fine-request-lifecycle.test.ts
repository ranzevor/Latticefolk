import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import http from 'node:http';
import {once} from 'node:events';
import * as random from '../src/world/worldRandom.js';
import {normalizeWildlifeDomestication,wildlifeHasActiveOwnerCommand} from '../src/world/domestication.js';

const source=fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const wanted=new Set(['postFineDecision','requestDecision','requestWildlifeBatch']);
const methods:string[]=[];
for(const node of ast.statements)if(ts.isClassDeclaration(node)&&node.name?.text==='TownGame')
  for(const member of node.members)if(ts.isMethodDeclaration(member)&&wanted.has(member.name.getText(ast)))methods.push(member.getText(ast));
assert.equal(methods.length,wanted.size);
const code=ts.transpileModule(`return class Runtime {${methods.join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;

function deferred(){
  let resolve!:(value:any)=>void,reject!:(error:Error)=>void;
  const promise=new Promise<any>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

function fixture(phase:'fetch'|'body'|'success'|'failure'){
  let clock=1000,sequence=0,calls=0;
  const timers=new Map<number,{at:number,callback:()=>void}>(),signals:AbortSignal[]=[],applied:any[]=[];
  const first=deferred();
  const payload={action:'idle',source:'fixture',confidence:1,decisions:[{wildlifeId:'a',action:'rest'}]};
  const response=()=>({ok:true,json:async()=>payload});
  const Runtime=new Function(...Object.keys(random),'normalizeWildlifeDomestication','wildlifeHasActiveOwnerCommand','fetch','now','setTimeout','clearTimeout',code)(
    ...Object.values(random),normalizeWildlifeDomestication,wildlifeHasActiveOwnerCommand,
    (_url:string,options:RequestInit)=>{
      signals.push(options.signal as AbortSignal);calls++;
      if(calls>1||phase==='success')return Promise.resolve(response());
      if(phase==='failure')return Promise.resolve({ok:false,json:()=>{throw new Error('must not parse error body');}});
      return phase==='fetch'?first.promise:Promise.resolve({ok:true,json:()=>first.promise});
    },()=>clock,
    (callback:()=>void,ms:number)=>{const id=++sequence;timers.set(id,{at:clock+ms,callback});return id;},
    (id:number)=>timers.delete(id));
  const runtime=new Runtime();
  const animal={state:{id:'a',species:'sheep',hunger:80,thirst:60,energy:40,health:90},removed:false,nextDecisionAt:0};
  const npc={state:{id:'n',name:'N'},removed:false,pendingDecision:false,nextDecisionAt:0};
  Object.assign(runtime,{randomness:random.readWorldRandomness(undefined),wildlife:new Map([['a',animal]]),wildlifeDecisionPending:false,nextWildlifeBatchAt:0,
    inFlight:0,perceptionEpoch:1,snapshot:()=>({}),allowedActions:()=>['idle'],wildlifeSnapshot:()=>({wildlife:animal.state}),
    applyDecision:(...args:any[])=>applied.push(args),applyWildlifeDecision:(...args:any[])=>applied.push(args),log:()=>{}});
  return {runtime,npc,animal,applied,signals,timers,calls:()=>calls,first,payload,response,
    async advance(ms:number){clock+=ms;for(const [id,timer] of timers)if(timer.at<=clock){timers.delete(id);timer.callback();}for(let i=0;i<12;i++)await Promise.resolve();}};
}

for(const method of ['requestDecision','requestWildlifeBatch'] as const){
  for(const phase of ['fetch','body'] as const)for(const late of ['resolve','reject'] as const){
    test(`${method} releases a hung ${phase} and ignores its late ${late}`,async()=>{
      const f=fixture(phase);let settled=false;
      const start=()=>method==='requestDecision'?f.runtime.requestDecision(f.npc):f.runtime.requestWildlifeBatch();
      const pending=start().then(()=>{settled=true;});
      await f.advance(7999);assert.equal(settled,false);assert.equal(f.signals[0].aborted,false);
      await f.advance(1);await pending;
      assert.equal(f.signals[0].aborted,true);assert.equal(f.npc.pendingDecision,false);
      assert.equal(f.runtime.inFlight,0);assert.equal(f.runtime.wildlifeDecisionPending,false);
      assert.equal(f.applied.length,0);assert.equal(f.timers.size,0);
      await f.advance(12000);await start();
      assert.equal(f.calls(),2);assert.equal(f.applied.length,1);
      const retryAt=method==='requestDecision'?f.npc.nextDecisionAt:f.animal.nextDecisionAt;
      if(late==='resolve')f.first.resolve(phase==='fetch'?f.response():f.payload);
      else f.first.reject(new Error('late transport error'));
      await f.advance(0);
      assert.equal(f.applied.length,1);assert.equal(f.runtime.inFlight,0);
      assert.equal(method==='requestDecision'?f.npc.nextDecisionAt:f.animal.nextDecisionAt,retryAt);
      assert.equal(f.timers.size,0);
    });
  }
  for(const phase of ['success','failure'] as const)test(`${method} clears the deadline after ${phase}`,async()=>{
    const f=fixture(phase);
    await (method==='requestDecision'?f.runtime.requestDecision(f.npc):f.runtime.requestWildlifeBatch());
    assert.equal(f.timers.size,0);assert.equal(f.applied.length,phase==='success'?1:0);
    await f.advance(8000);assert.equal(f.signals[0].aborted,phase==='failure');
    assert.equal(f.npc.pendingDecision,false);assert.equal(f.runtime.inFlight,0);assert.equal(f.runtime.wildlifeDecisionPending,false);
  });
}

const lateSource=fs.readFileSync(new URL('../e2e/world-randomness.spec.ts',import.meta.url),'utf8');
const lateAst=ts.createSourceFile('world-randomness.spec.ts',lateSource,ts.ScriptTarget.Latest,true);
const lateTest=lateAst.statements.find((node):node is ts.ExpressionStatement=>ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&ts.isStringLiteral(node.expression.arguments[0])&&node.expression.arguments[0].text==='late wildlife intent cannot mutate a rematerialized entity or consume its saved cursor')!;
let lateRoute:ts.Node|undefined;
const findLateRoute=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(lateAst)==='page.route'&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text==='**/api/wildlife/decide')lateRoute=node.arguments[1];ts.forEachChild(node,findLateRoute);};
findLateRoute(lateTest);assert.ok(lateRoute);
const phaseMarker=lateAst.statements.find((node):node is ts.FunctionDeclaration=>ts.isFunctionDeclaration(node)&&node.name?.text==='markLateWildlifeRequestPhase');
const selectionCode=ts.transpileModule(`let captureReady=false,captured;const rabbit={id:'rabbit_rng'},gate=Promise.resolve(),handled=()=>{};const handler=${lateRoute.getText(lateAst)};return{arm(){captureReady=true;},handler,captured:()=>captured};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
for(const scenario of [
  {name:'old request delayed through readiness',before:true,createdAt:1000,armedAt:8000,handledAt:8999},
  {name:'timed-out old request delivered after arming',before:true,createdAt:1000,armedAt:10000,handledAt:10001},
  {name:'request immediately before arming at the same clock',before:true,createdAt:8000,armedAt:8000,handledAt:8001},
  {name:'request immediately after arming at the same clock',before:false,createdAt:8000,armedAt:8000,handledAt:8001},
  {name:'new request after readiness',before:false,createdAt:8001,armedAt:8000,handledAt:8500}
])test(`late wildlife capture excludes pre-arm transport: ${scenario.name}`,async()=>{
  const selection=new Function('expect',selectionCode)((actual:unknown)=>({toBe:(expected:unknown)=>assert.equal(actual,expected)}));
  const events=new EventTarget(),timers=new Map<number,{at:number;callback:()=>void}>();let timerId=0,clock=scenario.createdAt;
  const body={requests:[{wildlife:{id:'rabbit_rng',randomEventCursor:17}}]};
  const transport=deferred();let outgoing:{wire:Request;init:RequestInit}|undefined;
  const window={fetch:(url:string,init:RequestInit)=>{outgoing={wire:new Request(new URL(url,'http://fixture.local'),init),init};return transport.promise;}};
  if(phaseMarker){const install=ts.transpileModule(phaseMarker.getText(lateAst)+';markLateWildlifeRequestPhase();',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;new Function('window','addEventListener','Headers',install)(window,events.addEventListener.bind(events),Headers);}
  const arm=()=>{clock=scenario.armedAt;selection.arm();events.dispatchEvent(new Event('latticefolk-e2e-wildlife-arm'));};
  if(!scenario.before)arm();clock=scenario.createdAt;
  const controllers:AbortController[]=[];class TrackedAbortController extends AbortController{constructor(){super();controllers.push(this);}}
  const Runtime=new Function('fetch','setTimeout','clearTimeout','AbortController',code)((url:string,init:RequestInit)=>window.fetch(url,init),(callback:()=>void,ms:number)=>{assert.equal(ms,8000);timers.set(++timerId,{at:clock+ms,callback});return timerId;},(id:number)=>timers.delete(id),TrackedAbortController);
  const result=new Runtime().postFineDecision('/api/wildlife/decide',body).then((value:unknown)=>({value,error:undefined}),(error:Error)=>({value:undefined,error}));
  assert.ok(outgoing);assert.equal(outgoing.init.body,JSON.stringify(body));assert.equal(outgoing.wire.headers.get('content-type'),'application/json');assert.equal(outgoing.init.method,'POST');assert.equal(outgoing.init.signal,controllers[0].signal);assert.equal(outgoing.init.signal?.aborted,false);
  const deadline=[...timers.values()][0];assert.equal(deadline.at,scenario.createdAt+8000);
  if(scenario.before){if(scenario.armedAt>=deadline.at){clock=deadline.at;deadline.callback();}arm();}clock=scenario.handledAt;
  const request={postDataJSON:()=>JSON.parse(outgoing!.init.body as string),headers:()=>Object.fromEntries(outgoing!.wire.headers)};
  let status=0;
  await selection.handler({request:()=>request,fulfill:async(options:{status?:number;json:unknown})=>{status=options.status??200;transport.resolve(new Response(JSON.stringify(options.json),{status}));}});
  const received=await result;
  assert.equal(Boolean(selection.captured()),!scenario.before);
  assert.equal(status,scenario.before?503:200);assert.equal(Boolean(received.error),scenario.before);assert.equal(timers.size,0);
  assert.equal(outgoing.init.signal?.aborted,scenario.before);
  if(!scenario.before)assert.deepEqual(received.value,{source:'e2e-late',decisions:[{wildlifeId:'rabbit_rng',action:'wander',source:'e2e-late',confidence:1,reasonCode:'old-owner'}]});
});

test('late wildlife phase marker preserves unrelated fetch inputs and request options',async()=>{
  assert.ok(phaseMarker);
  const events=new EventTarget(),forwarded:Array<{input:unknown;init:RequestInit|undefined}>=[];
  const window={fetch:(input:unknown,init?:RequestInit)=>{forwarded.push({input,init});return Promise.resolve(new Response(null,{status:204}));}};
  const install=ts.transpileModule(phaseMarker.getText(lateAst)+';markLateWildlifeRequestPhase();',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('window','addEventListener','Headers',install)(window,events.addEventListener.bind(events),Headers);
  const signal=new AbortController().signal,options={method:'POST',body:'{"requests":[]}',headers:{'content-type':'application/json','x-fixture':'kept'},signal};
  await window.fetch('/api/wildlife/decide',options);assert.equal(forwarded.at(-1)!.init,options);
  events.dispatchEvent(new Event('latticefolk-e2e-wildlife-arm'));
  for(const [input,init] of [['/api/decision',options],['/api/wildlife/decide',{...options,method:'GET'}],[new Request('http://fixture.local/api/wildlife/decide',options),undefined]] as const){
    await window.fetch(input,init);assert.equal(forwarded.at(-1)!.input,input);assert.equal(forwarded.at(-1)!.init,init);
  }
  await window.fetch('/api/wildlife/decide',options);const actual=forwarded.at(-1)!;
  assert.equal(actual.input,'/api/wildlife/decide');assert.equal(actual.init!.method,options.method);assert.equal(actual.init!.body,options.body);assert.equal(actual.init!.signal,signal);
  assert.deepEqual(Object.fromEntries(new Headers(actual.init!.headers)),{...options.headers,'x-latticefolk-e2e-wildlife-phase':'armed'});
});

test('native HTTP decision error closes its unread response stream',{timeout:4000},async()=>{
  const bodyClosed=deferred();
  const server=http.createServer((_request,response)=>{
    response.writeHead(503,{'content-type':'application/json'});
    response.write('{"error":"service unavailable');
    response.on('close',()=>bodyClosed.resolve(undefined));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const address=server.address();assert.ok(address&&typeof address!=='string');
    const signals:AbortSignal[]=[];
    const Runtime=new Function('fetch',code)((url:string,options:RequestInit)=>{
      signals.push(options.signal as AbortSignal);return globalThis.fetch(url,options);
    });
    await assert.rejects(new Runtime().postFineDecision(`http://127.0.0.1:${address.port}/api/decision`,{}),/decision request failed/);
    assert.equal(signals[0].aborted,true,'failed decision must release its unread response');
    await bodyClosed.promise;
  }finally{
    server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});
