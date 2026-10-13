import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import type { InventoryItem, ItemKind, NpcState, WorldObjectState } from '../src/types.js';
import { beginRandomEvent, readWorldRandomness } from '../src/world/worldRandom.js';
import { isBakingOven } from '../src/scene/bakingOven.js';
import { pickupWorldItem, planInventoryDrop } from '../src/world/portableObjects.js';

// Exercise the production methods together without booting a renderer or replacing
// harvest with a test-only implementation. Selection and completion remain real.
const source=ts.createSourceFile('main.ts',fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const cls=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='TownGame') as ts.ClassDeclaration;
const methods=['decorationState','defaultCapabilities','allowedActions','objectForAction','completeTask','npcHarvest','addInventory'];
const body=methods.map(name=>{
  const method=cls.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(source)===name);
  assert.ok(method,`Missing runtime method: ${name}`);
  return method.getText(source);
}).join('\n');
const code=ts.transpileModule(`return class {${body}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const Runtime=new Function('beginRandomEvent','isBakingOven','clamp','dist',code)(beginRandomEvent,isBakingOven,
  (v:number,min:number,max:number)=>Math.max(min,Math.min(max,v)),
  (a:{x:number;z:number},b:{x:number;z:number})=>Math.hypot(a.x-b.x,a.z-b.z));

function fixture(){
  const events:string[]=[],speech:string[]=[];
  const game=Object.assign(new Runtime(),{
    objects:new Map(),randomness:readWorldRandomness(undefined),
    itemName:(kind:ItemKind)=>kind,event:(message:string)=>events.push(message),
    say:(_agent:unknown,message:string)=>speech.push(message),playActivity:()=>{},
    findPath:()=>{throw new Error('An in-range interaction must not navigate');}
  });
  const state:NpcState={id:'forager',name:'Forager',role:'resident',position:{x:0,z:0},home:{x:0,z:0},
    mood:'neutral',hunger:20,energy:80,social:50,money:10,inventory:[],relationships:{},memories:[],
    currentAction:'harvest',goal:'Forage',lastDecisionAt:0};
  const agent:{state:NpcState;task?:{action:string;targetObjectId:string}}={state};
  const add=(state:WorldObjectState)=>{
    state.capabilities??=game.defaultCapabilities(state);
    const object={state,mesh:{visible:true}};
    game.objects.set(state.id,object);return object;
  };
  const harvest=(object:ReturnType<typeof add>)=>{
    const world={nearbyNpcs:[],nearbyObjects:[{...object.state,distance:0}]};
    assert.ok(game.allowedActions(agent,world).includes('harvest'));
    assert.equal(game.objectForAction(agent,'harvest',object.state.id),object);
    agent.task={action:'harvest',targetObjectId:object.state.id};
    game.completeTask(agent);assert.equal(agent.task,undefined);
  };
  return {game,agent,add,harvest,events,speech};
}

for(const asset of ['bush','flowers'])test(`real ${asset} selection and completion credits each harvested unit until exhausted`,()=>{
  const f=fixture(),object=f.add(f.game.decorationState(asset,0,0));
  for(let count=1;count<=3;count++){
    f.harvest(object);
    assert.deepEqual(f.agent.state.inventory,[{kind:'flower',count}]);
    assert.equal(object.state.resourceAmount,3-count);
    assert.equal(f.events.length,count);
  }
  const before=structuredClone(f.agent.state);
  f.harvest(object);
  assert.deepEqual(f.agent.state,before,'depleted source must not grant items or consume needs');
  assert.equal(f.events.length,3);assert.equal(f.speech.length,1);
  assert.equal(f.agent.state.randomEventCursor,undefined,'forage must not consume a farm-harvest random event');
});

test('forage transfers the source item and supports the existing flower default',()=>{
  for(const kind of ['bush','flower'] as const)for(const item of ['apple',undefined] as const){
    const f=fixture(),object=f.add({id:'forage',name:'Forage',kind,position:{x:0,z:0},tags:['nature'],
      item,resourceAmount:1,usable:true,pickupable:false});
    f.harvest(object);
    assert.deepEqual(f.agent.state.inventory,[{kind:item??'flower',count:1}]);
    assert.equal(object.state.resourceAmount,0);
  }
});

for(const [kind,tags,item,expected,count] of [
  ['rock',['nature','resource','stone'],'stone','stone',2],
  ['farm_plot',['farm','food'],'grain','grain',2],
  ['tree',['apple','nature'],'apple','apple',1],
  ['tree',['wood','nature'],'wood','wood',1]
] as const)test(`existing ${kind}/${item} harvest yield remains unchanged`,()=>{
  const f=fixture(),object=f.add({id:'source',name:'Source',kind,position:{x:0,z:0},tags:[...tags],
    item,resourceAmount:3,usable:true,pickupable:false});
  f.harvest(object);
  assert.equal(f.agent.state.inventory.find(slot=>slot.kind===expected)?.count,count);
  assert.equal(object.state.resourceAmount,2);assert.equal(f.agent.state.energy,74);
  assert.equal(f.agent.state.hunger,23);assert.equal(f.events.length,1);
  assert.equal(f.agent.state.randomEventCursor,kind==='farm_plot'?1:undefined);
});

test('a harvested flower continues through parcel transfer exactly once',()=>{
  const f=fixture(),object=f.add(f.game.decorationState('flowers',0,0));
  f.harvest(object);
  const plan=planInventoryDrop(f.agent.state.inventory,'drop_flower','Parcel',{x:0,z:0});
  assert.ok(plan,'successful foraging must create an inventory item that can be dropped');
  plan.source.count--;
  const recipient:InventoryItem[]=[];
  assert.deepEqual(pickupWorldItem(plan.object,recipient,1000),{kind:'flower',count:1});
  assert.equal(pickupWorldItem(plan.object,recipient,1001),undefined);
  assert.equal(f.agent.state.inventory[0].count+recipient[0].count+object.state.resourceAmount!,3);
});
