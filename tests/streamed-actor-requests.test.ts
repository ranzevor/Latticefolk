import * as worldRandom from '../src/world/worldRandom.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import {wildlifeHasActiveOwnerCommand,normalizeWildlifeDomestication} from '../src/world/domestication.js';
const source=fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8'),ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const wanted=new Set(['postFineDecision','requestWildlifeBatch','requestDecision','playerTalk','npcTalkPlayerAuto','npcConversation']);
const methods:string[]=[];for(const n of ast.statements)if(ts.isClassDeclaration(n)&&n.name?.text==='TownGame')for(const m of n.members)if(ts.isMethodDeclaration(m)&&wanted.has(m.name.getText(ast)))methods.push(m.getText(ast));
assert.equal(methods.length,wanted.size);
const code=ts.transpileModule(`return class Runtime {${methods.join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(){
 let resolve!:(response:any)=>void,reject!:(error:Error)=>void,calls=0;
 const response=new Promise((yes,no)=>{resolve=yes;reject=no;});
 const Runtime=new Function(...Object.keys(worldRandom),'normalizeWildlifeDomestication','fetch','now','wildlifeHasActiveOwnerCommand','clamp',code)(...Object.values(worldRandom),normalizeWildlifeDomestication,()=>{calls++;return response;},()=>1000,wildlifeHasActiveOwnerCommand,(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n)));
 const r=new Runtime(),applied:any[]=[],spoken:string[]=[],remembered:string[]=[];
 Object.assign(r,{randomness:worldRandom.readWorldRandomness(undefined),wildlife:new Map(),wildlifeDecisionPending:false,nextWildlifeBatchAt:0,inFlight:0,perceptionEpoch:1,cameraMode:'firstPerson',locale:'en',weather:'clear',
  wildlifeSnapshot:(x:any)=>({wildlife:x.state}),applyWildlifeDecision:(...args:any[])=>applied.push(args),snapshot:()=>({}),allowedActions:()=>['idle'],applyDecision:(...args:any[])=>applied.push(args),
  gameTimeText:()=> '08:15',nearbyTags:()=>[],say:(_n:any,text:string)=>spoken.push(text),remember:(_n:any,text:string)=>remembered.push(text),actor:(n:any)=>({id:n.state.id}),applyRelation(){},log(){}});
 return {r,applied,spoken,remembered,calls:()=>calls,reply:(decisions:any[])=>resolve({ok:true,json:async()=>({decisions})}),dialogue:()=>resolve({ok:true,json:async()=>({text:'late',relationEffect:'positive'})}),fail:()=>reject(new Error('late failure'))};
}
const animal=(id='a')=>({state:{id,species:'sheep',hunger:80,thirst:60,energy:40,health:90},mesh:{},nextDecisionAt:0,removed:false});
const npc=()=>({state:{id:'n',name:'N',role:'farmer',mood:'neutral',social:20,position:{x:48,z:0},relationships:{},memories:[]},mesh:{},nextDecisionAt:0,pendingDecision:false,removed:false});

test('late wildlife replies cannot target a new runtime that reuses the old visual',async()=>{
 const f=fixture(),old=animal();f.r.wildlife.set('a',old);const pending=f.r.requestWildlifeBatch();
 const current={...animal(),mesh:old.mesh,nextDecisionAt:17};old.removed=true;f.r.wildlife.set('a',current);
 f.reply([{wildlifeId:'a',action:'rest'}]);await pending;assert.equal(f.applied.length,0);assert.equal(current.nextDecisionAt,17);
});
test('a live batch accepts each requested identity once and rejects extra identities',async()=>{
 const f=fixture(),current=animal();f.r.wildlife.set('a',current);f.r.wildlife.set('not-due',{...animal('not-due'),nextDecisionAt:5000});
 const pending=f.r.requestWildlifeBatch();await f.r.requestWildlifeBatch();assert.equal(f.calls(),1);
 f.reply([{wildlifeId:'a',action:'rest'},{wildlifeId:'a',action:'forage'},{wildlifeId:'not-due',action:'rest'}]);await pending;
 assert.equal(f.applied.length,1);assert.equal(f.applied[0][0],current);assert.equal(f.applied[0][1].action,'rest');assert.equal(f.r.wildlifeDecisionPending,false);
});
test('an owner command changed during the request supersedes its old intent',async()=>{
 const f=fixture(),current:any=animal();f.r.wildlife.set('a',current);const pending=f.r.requestWildlifeBatch();
 current.state.domestication={ownerId:'player',command:'stay',tameProgress:100,breedingAllowed:false};
 f.reply([{wildlifeId:'a',action:'wander'}]);await pending;assert.equal(f.applied.length,0);
});
test('failed old batches cannot rewrite the wake time of replaced or removed actors',async()=>{
 const f=fixture(),old=animal();f.r.wildlife.set('a',old);const pending=f.r.requestWildlifeBatch();
 old.removed=true;const current={...animal(),mesh:old.mesh,nextDecisionAt:17};f.r.wildlife.set('a',current);f.fail();await pending;
 assert.equal(old.nextDecisionAt,0);assert.equal(current.nextDecisionAt,17);assert.equal(f.r.wildlifeDecisionPending,false);
});
test('old NPC decision cleanup cannot take over a new runtime sharing its visual',async()=>{
 const f=fixture(),old=npc();const pending=f.r.requestDecision(old);old.removed=true;
 const current={...npc(),mesh:old.mesh,pendingDecision:true,nextDecisionAt:17};f.reply([]);await pending;
 assert.equal(f.applied.length,0);assert.equal(current.pendingDecision,true);assert.equal(current.nextDecisionAt,17);assert.equal(f.r.inFlight,0);
});
for(const method of ['playerTalk','npcTalkPlayerAuto','npcConversation'])for(const failed of [false,true])test(`${method}: a retired speaker ignores ${failed?'failed':'successful'} dialogue`,async()=>{
 const f=fixture(),speaker=npc(),listener={...npc(),state:{...npc().state,id:'listener'}};
 const pending=method==='npcConversation'?f.r[method](speaker,listener,'smalltalk'):f.r[method](speaker,'smalltalk');
 speaker.removed=true;if(failed)f.fail();else f.dialogue();await pending;
 assert.equal(f.spoken.length,0);assert.equal(f.remembered.length,0);assert.equal((speaker.state as any).lastDialogue,undefined);
});
test('current player dialogue still applies its accepted result',async()=>{
 const f=fixture(),speaker=npc(),pending=f.r.playerTalk(speaker);f.dialogue();await pending;
 assert.deepEqual(f.spoken,['late']);assert.equal(f.remembered.length,1);assert.equal((speaker.state as any).lastDialogue,'late');
});
