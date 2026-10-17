import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import type { CoarseChunkState, NpcState, WorldObjectState } from '../src/types.js';
import { planFineChunk } from '../src/world/materialization.js';
import { isBakingOven } from '../src/scene/bakingOven.js';

// Use actual planned sources and production selection/completion methods. No
// renderer, provider request, or duplicate test implementation of water collection.
const source=ts.createSourceFile('main.ts',fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const cls=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='TownGame') as ts.ClassDeclaration;
const body=['defaultCapabilities','allowedActions','objectForAction','completeTask','npcFetchWater','addInventory'].map(name=>{
  const method=cls.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(source)===name);
  assert.ok(method,`Missing runtime method: ${name}`);
  return method.getText(source);
}).join('\n');
const code=ts.transpileModule(`return class {${body}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const Runtime=new Function('isBakingOven','clamp','dist',code)(isBakingOven,
  (value:number,min:number,max:number)=>Math.max(min,Math.min(max,value)),
  (a:{x:number;z:number},b:{x:number;z:number})=>Math.hypot(a.x-b.x,a.z-b.z));

function sourcePlan(kind:'well'|'water_patch'){
  const chunk:CoarseChunkState={id:'chunk_2_0',cx:2,cz:0,biome:'wetlands',settlementLevel:kind==='well'?1:0,
    population:5,food:60,wood:50,water:72,ecology:60,danger:0,prosperity:30,
    strategy:'sustain',migrationPolicy:'retain',ecologyPolicy:'balance',lastDecisionAt:0,decisionVersion:0};
  const state=planFineChunk(chunk).objects.find(object=>object.state.kind===kind)?.state;
  assert.ok(state,`The real fine planner must produce ${kind}`);
  return state;
}

function fixture(state:WorldObjectState){
  const messages:string[]=[],events:string[]=[],paths:{x:number;z:number}[]=[];
  const game=Object.assign(new Runtime(),{objects:new Map(),
    say:(_agent:unknown,message:string)=>messages.push(message),event:(message:string)=>events.push(message),
    playActivity:()=>{},findPath:(_from:unknown,to:{x:number;z:number})=>{paths.push({...to});return [{...to}];}});
  const agent:{state:NpcState;task?:{action:string;targetObjectId:string};path?:{x:number;z:number}[]}={
    state:{id:'collector',name:'Collector',role:'resident',position:{x:state.position.x-1,z:state.position.z},home:{x:0,z:0},
      mood:'neutral',hunger:20,energy:80,social:50,money:10,inventory:[{kind:'water',count:2}],relationships:{},memories:[],
      currentAction:'fetch_water',goal:'Fetch water',lastDecisionAt:0}};
  const object={state,mesh:{visible:true}};game.objects.set(state.id,object);
  return {game,agent,object,messages,events,paths};
}

for(const kind of ['well','water_patch'] as const)test(`real ${kind} contract selects and completes NPC fetch_water exactly once`,()=>{
  const f=fixture(sourcePlan(kind));
  assert.ok(f.object.state.capabilities?.includes('draw_water'));
  assert.ok(f.game.defaultCapabilities(f.object.state).includes('draw_water'));
  assert.ok(f.game.allowedActions(f.agent,{nearbyNpcs:[],nearbyObjects:[{...f.object.state,distance:1}]}).includes('fetch_water'));
  assert.equal(f.game.objectForAction(f.agent,'fetch_water',f.object.state.id),f.object);
  f.agent.task={action:'fetch_water',targetObjectId:f.object.state.id};
  f.game.completeTask(f.agent);
  assert.deepEqual(f.agent.state.inventory,[{kind:'water',count:3}]);
  assert.equal(f.agent.state.energy,79);assert.equal(f.agent.state.hunger,20);
  assert.equal(f.agent.task,undefined);assert.equal(f.messages.length,1);assert.equal(f.events.length,1);
  if(kind==='water_patch')assert.ok(f.events[0].includes(f.object.state.name),'natural-water event must not claim a well');
  f.game.completeTask(f.agent);
  assert.deepEqual(f.agent.state.inventory,[{kind:'water',count:3}]);
  assert.equal(f.agent.state.energy,79);assert.equal(f.events.length,1);
});

test('natural-water fetch task navigates first and does not reward an out-of-range actor',()=>{
  const f=fixture(sourcePlan('water_patch'));
  f.agent.state.position.x-=10;
  f.agent.task={action:'fetch_water',targetObjectId:f.object.state.id};
  const before=structuredClone(f.agent.state);
  f.game.completeTask(f.agent);
  assert.deepEqual(f.agent.state,before);assert.ok(f.agent.task);
  assert.deepEqual(f.paths,[f.object.state.position]);assert.equal(f.events.length,0);
});

test('non-water objects neither offer fetch_water nor grant water through its runtime',()=>{
  const f=fixture({id:'bench',name:'Bench',kind:'bench',position:{x:0,z:0},tags:['rest'],usable:true,pickupable:false});
  f.object.state.capabilities=f.game.defaultCapabilities(f.object.state);
  assert.equal(f.game.objectForAction(f.agent,'fetch_water',f.object.state.id),undefined);
  assert.equal(f.game.allowedActions(f.agent,{nearbyNpcs:[],nearbyObjects:[{...f.object.state,distance:1}]}).includes('fetch_water'),false);
  const before=structuredClone(f.agent.state);
  f.game.npcFetchWater(f.agent,f.object);
  assert.deepEqual(f.agent.state,before);assert.equal(f.events.length,0);assert.equal(f.messages.length,0);
});
