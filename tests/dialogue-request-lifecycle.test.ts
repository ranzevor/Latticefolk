import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const names=['postFineDecision','npcConversation','npcTalkPlayerAuto','playerTalk'];
const methods:string[]=[];
for(const node of ast.statements)if(ts.isClassDeclaration(node)&&node.name?.text==='TownGame')
  for(const member of node.members)if(ts.isMethodDeclaration(member)&&names.includes(member.name.getText(ast)))methods.push(member.getText(ast));
assert.equal(methods.length,names.length);
const code=ts.transpileModule(`return class Runtime {${methods.join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const npc=(id:string)=>({state:{id,name:id,role:'resident',mood:'calm',social:20,position:{x:0,z:0},relationships:{},memories:[],lastDialogue:'previous'},removed:false});
function fixture(phase:'fetch'|'body'|'failure'|'success'){
  let clock=0,sequence=0,calls=0,resolve!:(value:unknown)=>void;
  const held=new Promise(yes=>{resolve=yes;});
  const timers=new Map<number,{at:number;callback:()=>void}>(),signals:AbortSignal[]=[],spoken:string[]=[],memories:string[]=[],relations:string[]=[];
  const payload={text:'accepted',relationEffect:'positive',source:'fixture'};
  const response=()=>({ok:true,json:async()=>payload});
  const Runtime=new Function('fetch','setTimeout','clearTimeout','clamp',code)(
    (_url:string,options:RequestInit)=>{
      calls++;signals.push(options.signal as AbortSignal);
      if(calls>1||phase==='success')return Promise.resolve(response());
      if(phase==='failure')return Promise.resolve({ok:false,json:async()=>payload});
      return phase==='fetch'?held:Promise.resolve({ok:true,json:()=>held});
    },(callback:()=>void,ms:number)=>{const id=++sequence;timers.set(id,{at:clock+ms,callback});return id;},
    (id:number)=>timers.delete(id),(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n)));
  const runtime=new Runtime(),speaker=npc('speaker'),listener=npc('listener');
  Object.assign(runtime,{locale:'en',cameraMode:'firstPerson',perceptionEpoch:1,weather:'clear',actor:(n:ReturnType<typeof npc>)=>({id:n.state.id}),gameTimeText:()=> '08:00',nearbyTags:()=>[],
    say:(_n:unknown,text:string)=>spoken.push(text),remember:(_n:unknown,text:string)=>memories.push(text),applyRelation:(_a:unknown,_b:unknown,effect:string)=>relations.push(effect),log(){}});
  return {runtime,speaker,listener,spoken,memories,relations,signals,timers,payload,response,resolve,
    async advance(ms:number){clock+=ms;for(const[id,timer]of timers)if(timer.at<=clock){timers.delete(id);timer.callback();}for(let i=0;i<12;i++)await Promise.resolve();}};
}
for(const method of ['npcConversation','npcTalkPlayerAuto','playerTalk'] as const){
  const start=(f:ReturnType<typeof fixture>)=>method==='npcConversation'?f.runtime[method](f.speaker,f.listener,'smalltalk'):f.runtime[method](f.speaker,'smalltalk');
  for(const phase of ['fetch','body'] as const)test(`${method} bounds ${phase} lifetime and rejects a late reply after retry`,async()=>{
    const f=fixture(phase);let settled=false;const pending=start(f).then(()=>{settled=true;});
    await f.advance(7999);assert.equal(settled,false);
    await f.advance(1);assert.equal(settled,true);await pending;
    assert.equal(f.signals[0].aborted,true);assert.equal(f.timers.size,0);
    assert.equal(f.speaker.state.lastDialogue,'previous');assert.equal(f.memories.length,0);assert.equal(f.relations.length,0);
    await start(f);assert.equal(f.speaker.state.lastDialogue,'accepted');assert.equal(f.memories.length,1);
    const spoken=f.spoken.length,relations=f.relations.length;
    f.resolve(phase==='fetch'?f.response():f.payload);await f.advance(0);
    assert.equal(f.spoken.length,spoken);assert.equal(f.memories.length,1);assert.equal(f.relations.length,relations);
  });
  test(`${method} refuses an unsuccessful HTTP response without applying dialogue`,async()=>{
    const f=fixture('failure');await start(f);
    assert.equal(f.speaker.state.lastDialogue,'previous');assert.equal(f.memories.length,0);assert.equal(f.relations.length,0);
    assert.equal(f.spoken.length,1);assert.notEqual(f.spoken[0],'accepted');assert.equal(f.timers.size,0);
  });
  test(`${method} accepts a successful response and clears its deadline`,async()=>{
    const f=fixture('success');await start(f);assert.equal(f.speaker.state.lastDialogue,'accepted');assert.equal(f.memories.length,1);
    assert.equal(f.timers.size,0);await f.advance(8000);assert.equal(f.spoken.length,1);assert.notEqual(f.signals[0]?.aborted,true);
  });
}
