import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import {once} from 'node:events';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const wanted=new Set(['initializePersistence','saveWorldState','scheduleMovablePersistence','clearMovablePersistenceQueue']);
const methods:string[]=[];
for(const node of ast.statements)if(ts.isClassDeclaration(node)&&node.name?.text==='TownGame')for(const member of node.members){
  if(ts.isMethodDeclaration(member)&&wanted.has(member.name.getText(ast)))methods.push(member.getText(ast));
}
assert.equal(methods.length,wanted.size);
const code=ts.transpileModule(`return class Runtime {${methods.join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
type Reply={ok:boolean;status:number;json:()=>Promise<unknown>};
function fixture(stage:'fetch'|'body'|'ok'='fetch',status=200,retryStatus=200,transport?:(url:string,options:{signal:AbortSignal;body:string})=>Promise<Reply>){
  const gate=deferred<Reply>(),body=deferred<unknown>(),bodyStarted=deferred<void>(),calls:Array<{signal:AbortSignal;body:string}>=[];
  const deadlines=new Map<number,()=>void>(),timers=new Map<number,()=>void>(),ack:number[]=[];
  let id=0;
  const response=():Reply=>({ok:status===200,status,json:()=>{bodyStarted.resolve();return stage==='body'?body.promise:Promise.resolve(status===409?{currentRevision:8}:{revision:8});}});
  const fetch=async(_url:string,options:{signal:AbortSignal;body:string}):Promise<Reply>=>{
    calls.push(options);
    if(transport)return transport(_url,options);
    if(calls.length===1)return stage==='fetch'?gate.promise:response();
    return {ok:retryStatus===200,status:retryStatus,json:async()=>retryStatus===409?{currentRevision:8}:{revision:8}};
  };
  const deps={fetch,AbortController,window:{setTimeout(fn:()=>void){const n=++id;timers.set(n,fn);return n;},clearTimeout(n:number){timers.delete(n);}},
    now:()=>1000,i18n:{t:(key:string)=>key},setTimeout(fn:()=>void,ms:number){assert.equal(ms,30000);const n=++id;deadlines.set(n,fn);return n;},clearTimeout(n:number){deadlines.delete(n);}};
  const Runtime=new Function(...Object.keys(deps),code)(...Object.values(deps)),runtime=new Runtime();
  Object.assign(runtime,{persistenceConflict:false,persistenceLoadBlocked:false,persistenceReady:true,persistenceSaveInFlight:false,persistenceSaveQueued:false,persistenceRevision:7,movableDirty:true,movableSaveRetryMs:1500,
    portables:{checkpoint:{capture:()=>1,acknowledge:(v:number)=>ack.push(v)}},flushWildlifeHabitatExposure(){},buildWorldSnapshot:()=>({edit:1}),log(){}});
  const expire=()=>{assert.equal(deadlines.size,1);const [n,fn]=deadlines.entries().next().value!;deadlines.delete(n);fn();};
  return {runtime,calls,deadlines,timers,ack,gate,body,bodyStarted,response,expire};
}

for(const stage of ['fetch','body'] as const)test(`${stage} deadline releases save while retaining dirty state and CAS revision`,async()=>{
  const f=fixture(stage),r=f.runtime,pending=r.saveWorldState();
  if(stage==='body')await f.bodyStarted.promise;else await Promise.resolve();f.expire();await pending;
  assert.equal(r.persistenceSaveInFlight,false);assert.equal(r.movableDirty,true);assert.equal(r.persistenceRevision,7);assert.equal(f.ack.length,0);
  assert.equal(f.calls[0].signal.aborted,true);assert.equal(f.timers.size,1);
  r.clearMovablePersistenceQueue();await r.saveWorldState();
  assert.equal(f.calls.length,2);assert.equal(JSON.parse(f.calls[1].body).expectedRevision,7);assert.equal(r.persistenceRevision,8);assert.deepEqual(f.ack,[1]);
  f.gate.resolve(f.response());f.body.resolve({revision:999});await Promise.resolve();await Promise.resolve();
  assert.equal(r.persistenceRevision,8);assert.deepEqual(f.ack,[1]);assert.equal(f.deadlines.size,0);
});
test('normal save clears the deadline and confirms once',async()=>{
  const f=fixture('ok');await f.runtime.saveWorldState();assert.equal(f.runtime.persistenceRevision,8);assert.equal(f.deadlines.size,0);assert.equal(f.timers.size,0);assert.deepEqual(f.ack,[1]);
});
test('409 remains terminal without acknowledging or scheduling another write',async()=>{
  const f=fixture('ok',409);await f.runtime.saveWorldState();assert.equal(f.runtime.persistenceConflict,true);assert.equal(f.runtime.persistenceRevision,7);assert.equal(f.ack.length,0);assert.equal(f.deadlines.size,0);assert.equal(f.timers.size,0);await f.runtime.saveWorldState();assert.equal(f.calls.length,1);
});
test('a hanging 409 response body cannot retain the single-flight slot',async()=>{
  const f=fixture('body',409),pending=f.runtime.saveWorldState();await f.bodyStarted.promise;await f.runtime.saveWorldState();assert.equal(f.runtime.persistenceSaveQueued,true);f.expire();await pending;assert.equal(f.runtime.persistenceSaveInFlight,false);assert.equal(f.runtime.persistenceRevision,7);assert.equal(f.ack.length,0);
  assert.equal(f.runtime.persistenceConflict,true);assert.equal(f.runtime.persistenceSaveQueued,false);assert.equal(f.runtime.movableDirty,true);assert.equal(f.timers.size,0);await f.runtime.saveWorldState();assert.equal(f.calls.length,1);
});
test('terminal runtime suppresses retries after a save timeout',async()=>{
  const f=fixture(),pending=f.runtime.saveWorldState();f.runtime.persistenceLoadBlocked=true;f.expire();await pending;assert.equal(f.runtime.persistenceSaveInFlight,false);assert.equal(f.timers.size,0);assert.equal(f.runtime.movableDirty,true);
});
test('lost ACK followed by committed-server conflict preserves unconfirmed local edits',async()=>{
  const f=fixture('body',200,409),r=f.runtime,pending=r.saveWorldState();await f.bodyStarted.promise;f.expire();await pending;
  r.clearMovablePersistenceQueue();await r.saveWorldState();
  assert.equal(JSON.parse(f.calls[1].body).expectedRevision,7);assert.equal(r.persistenceConflict,true);assert.equal(r.persistenceRevision,7);assert.equal(r.movableDirty,true);assert.equal(f.ack.length,0);
  f.body.resolve({revision:8});await Promise.resolve();await Promise.resolve();
  assert.equal(r.persistenceRevision,7);assert.equal(f.ack.length,0);await r.saveWorldState();assert.equal(f.calls.length,2);assert.equal(f.deadlines.size,0);assert.equal(f.timers.size,0);
});
test('save queued during a hung request proceeds only after its deadline releases the slot',async()=>{
  const f=fixture(),r=f.runtime,pending=r.saveWorldState();await r.saveWorldState();assert.equal(f.calls.length,1);assert.equal(r.persistenceSaveQueued,true);
  f.expire();await pending;assert.equal(f.calls.length,2);assert.equal(r.persistenceSaveInFlight,false);assert.equal(r.persistenceSaveQueued,false);assert.equal(r.persistenceRevision,8);assert.deepEqual(f.ack,[1]);assert.equal(f.deadlines.size,0);
});

for(const payload of [null,undefined])test(`409 with ${String(payload)} JSON stays terminal and retains unconfirmed edits`,async()=>{
  const f=fixture('body',409),r=f.runtime,pending=r.saveWorldState();
  await f.bodyStarted.promise;await r.saveWorldState();f.body.resolve(payload);await pending;
  assert.equal(r.persistenceConflict,true);assert.equal(r.persistenceSaveInFlight,false);
  assert.equal(r.persistenceSaveQueued,false);assert.equal(r.persistenceRevision,7);
  assert.equal(r.movableDirty,true);assert.deepEqual(f.ack,[]);assert.equal(f.timers.size,0);
  await r.saveWorldState();assert.equal(f.calls.length,1);assert.equal(f.deadlines.size,0);
});

for(const status of [400,429,500,503])test(`${status} response aborts its unread body before retrying`,async()=>{
  const f=fixture('ok',status),r=f.runtime;
  await r.saveWorldState();
  assert.equal(f.calls[0].signal.aborted,true,'unread HTTP error body must not outlive its request');
  assert.equal(r.persistenceSaveInFlight,false);assert.equal(r.persistenceConflict,false);
  assert.equal(r.persistenceRevision,7);assert.equal(r.movableDirty,true);assert.deepEqual(f.ack,[]);
  assert.equal(f.deadlines.size,0);assert.equal(f.timers.size,1);
  r.clearMovablePersistenceQueue();await r.saveWorldState();
  assert.equal(JSON.parse(f.calls[1].body).expectedRevision,7);
  assert.equal(r.persistenceRevision,8);assert.deepEqual(f.ack,[1]);assert.equal(f.timers.size,0);
});

test('native HTTP streaming error connection closes when the save attempt finishes',{timeout:4000},async()=>{
  const bodyClosed=deferred<void>();
  const server=http.createServer((_request,response)=>{
    response.writeHead(503,{'content-type':'application/json'});
    response.write('{"error":"service unavailable');
    response.on('close',()=>bodyClosed.resolve());
    // A broken proxy can deliver an error status without ever completing its body.
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const address=server.address();assert.ok(address&&typeof address!=='string');
    const f=fixture('ok',503,200,(_url,options)=>globalThis.fetch(`http://127.0.0.1:${address.port}/api/world/state`,options));
    await f.runtime.saveWorldState();
    assert.equal(f.calls[0].signal.aborted,true,'returning from a failed save must release its unread response');
    await bodyClosed.promise;
    assert.equal(f.runtime.persistenceSaveInFlight,false);assert.equal(f.runtime.persistenceRevision,7);
    assert.equal(f.runtime.movableDirty,true);assert.deepEqual(f.ack,[]);assert.equal(f.timers.size,1);
    assert.equal(f.deadlines.size,0);f.runtime.clearMovablePersistenceQueue();
  }finally{
    server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});


test('initial HTTP error also closes its unread stream and leaves saving blocked',{timeout:4000},async()=>{
  const bodyClosed=deferred<void>();
  const server=http.createServer((_request,response)=>{
    response.writeHead(503,{'content-type':'application/json'});
    response.write('{"error":"service unavailable');
    response.on('close',()=>bodyClosed.resolve());
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const address=server.address();assert.ok(address&&typeof address!=='string');
    const requests:AbortSignal[]=[],deadlines=new Map<number,()=>void>();
    const deps={AbortController,now:()=>1000,i18n:{t:(key:string)=>key},
      fetch:(_url:string,options:{signal:AbortSignal})=>{requests.push(options.signal);return globalThis.fetch(`http://127.0.0.1:${address.port}/api/world/state`,options);},
      setTimeout(fn:()=>void,ms:number){assert.equal(ms,8000);deadlines.set(1,fn);return 1;},clearTimeout(id:number){deadlines.delete(id);}};
    const Runtime=new Function(...Object.keys(deps),code)(...Object.values(deps)),r=new Runtime();
    Object.assign(r,{persistenceReady:false,persistenceRevision:7,persistenceConflict:false,persistenceLoadBlocked:false,
      persistenceSaveQueued:false,movableDirty:true,coarseWorld:{},initializeWorld(){},updateFineChunkMaterialization(){},log(){}});
    await r.initializePersistence();
    assert.equal(requests[0].aborted,true,'failed initial load must release its unread response');
    await bodyClosed.promise;
    assert.equal(r.persistenceReady,true);assert.equal(r.persistenceLoadBlocked,true);
    assert.equal(r.persistenceRevision,7);assert.equal(r.movableDirty,true);assert.equal(deadlines.size,0);
    await r.saveWorldState();assert.equal(requests.length,1);
  }finally{
    server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});
