import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const wanted=new Set(['saveWorldState','scheduleMovablePersistence','clearMovablePersistenceQueue']);
const methods:string[]=[];
for(const node of ast.statements)if(ts.isClassDeclaration(node)&&node.name?.text==='TownGame')for(const member of node.members){
  if(ts.isMethodDeclaration(member)&&wanted.has(member.name.getText(ast)))methods.push(member.getText(ast));
}
assert.equal(methods.length,wanted.size);
const code=ts.transpileModule(`return class Runtime {${methods.join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
type Reply={ok:boolean;status:number;json:()=>Promise<unknown>};
function fixture(stage:'fetch'|'body'|'ok'='fetch',status=200,retryStatus=200){
  const gate=deferred<Reply>(),body=deferred<unknown>(),calls:Array<{signal:AbortSignal;body:string}>=[];
  const deadlines=new Map<number,()=>void>(),timers=new Map<number,()=>void>(),ack:number[]=[];
  let id=0;
  const response=():Reply=>({ok:status===200,status,json:()=>stage==='body'?body.promise:Promise.resolve(status===409?{currentRevision:8}:{revision:8})});
  const fetch=async(_url:string,options:{signal:AbortSignal;body:string}):Promise<Reply>=>{
    calls.push(options);
    if(calls.length===1)return stage==='fetch'?gate.promise:response();
    return {ok:retryStatus===200,status:retryStatus,json:async()=>retryStatus===409?{currentRevision:8}:{revision:8}};
  };
  const deps={fetch,AbortController,window:{setTimeout(fn:()=>void){const n=++id;timers.set(n,fn);return n;},clearTimeout(n:number){timers.delete(n);}},
    now:()=>1000,i18n:{t:(key:string)=>key},setTimeout(fn:()=>void,ms:number){assert.equal(ms,30000);const n=++id;deadlines.set(n,fn);return n;},clearTimeout(n:number){deadlines.delete(n);}};
  const Runtime=new Function(...Object.keys(deps),code)(...Object.values(deps)),runtime=new Runtime();
  Object.assign(runtime,{persistenceConflict:false,persistenceLoadBlocked:false,persistenceReady:true,persistenceSaveInFlight:false,persistenceSaveQueued:false,persistenceRevision:7,movableDirty:true,movableSaveRetryMs:1500,
    portables:{checkpoint:{capture:()=>1,acknowledge:(v:number)=>ack.push(v)}},flushWildlifeHabitatExposure(){},buildWorldSnapshot:()=>({edit:1}),log(){}});
  const expire=()=>{assert.equal(deadlines.size,1);const [n,fn]=deadlines.entries().next().value!;deadlines.delete(n);fn();};
  return {runtime,calls,deadlines,timers,ack,gate,body,response,expire};
}

for(const stage of ['fetch','body'] as const)test(`${stage} deadline releases save while retaining dirty state and CAS revision`,async()=>{
  const f=fixture(stage),r=f.runtime,pending=r.saveWorldState();
  await Promise.resolve();f.expire();await pending;
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
  const f=fixture('body',409),pending=f.runtime.saveWorldState();await Promise.resolve();f.expire();await pending;assert.equal(f.runtime.persistenceSaveInFlight,false);assert.equal(f.runtime.persistenceRevision,7);assert.equal(f.ack.length,0);
});
test('terminal runtime suppresses retries after a save timeout',async()=>{
  const f=fixture(),pending=f.runtime.saveWorldState();f.runtime.persistenceLoadBlocked=true;f.expire();await pending;assert.equal(f.runtime.persistenceSaveInFlight,false);assert.equal(f.timers.size,0);assert.equal(f.runtime.movableDirty,true);
});
test('lost ACK followed by committed-server conflict preserves unconfirmed local edits',async()=>{
  const f=fixture('body',200,409),r=f.runtime,pending=r.saveWorldState();await Promise.resolve();f.expire();await pending;
  r.clearMovablePersistenceQueue();await r.saveWorldState();
  assert.equal(JSON.parse(f.calls[1].body).expectedRevision,7);assert.equal(r.persistenceConflict,true);assert.equal(r.persistenceRevision,7);assert.equal(r.movableDirty,true);assert.equal(f.ack.length,0);
  f.body.resolve({revision:8});await Promise.resolve();await Promise.resolve();
  assert.equal(r.persistenceRevision,7);assert.equal(f.ack.length,0);await r.saveWorldState();assert.equal(f.calls.length,2);assert.equal(f.deadlines.size,0);assert.equal(f.timers.size,0);
});
test('save queued during a hung request proceeds only after its deadline releases the slot',async()=>{
  const f=fixture(),r=f.runtime,pending=r.saveWorldState();await r.saveWorldState();assert.equal(f.calls.length,1);assert.equal(r.persistenceSaveQueued,true);
  f.expire();await pending;assert.equal(f.calls.length,2);assert.equal(r.persistenceSaveInFlight,false);assert.equal(r.persistenceSaveQueued,false);assert.equal(r.persistenceRevision,8);assert.deepEqual(f.ack,[1]);assert.equal(f.deadlines.size,0);
});
