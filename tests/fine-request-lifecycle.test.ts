import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
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
    await f.advance(8000);assert.equal(f.signals[0].aborted,false);
    assert.equal(f.npc.pendingDecision,false);assert.equal(f.runtime.inFlight,0);assert.equal(f.runtime.wildlifeDecisionPending,false);
  });
}

