import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as random from '../src/world/worldRandom.js';
import * as species from '../src/world/wildlifeSpecies.js';
import * as phenotype from '../src/world/wildlifePhenotype.js';
import * as organisms from '../src/world/organismFamilies.js';
import type {WildlifeAction,WildlifeSpecies,WorldObjectState} from '../src/types.js';

const ast=ts.createSourceFile('main.ts',fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const names=new Set(['applyWildlifeDecision','findWildlifeResource','completeWildlifeAction']);
const members:string[]=[];
for(const node of ast.statements)if(ts.isClassDeclaration(node)&&node.name?.text==='TownGame')for(const method of node.members)
  if(ts.isMethodDeclaration(method)&&names.has(method.name.getText(ast)))members.push(method.getText(ast));
assert.equal(members.length,names.size);
const code=ts.transpileModule(`return class Runtime {${members.join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(action:WildlifeAction,speciesName:WildlifeSpecies='deer'){
  const dependencies={...random,...species,...phenotype,...organisms,now:()=>1000,dist:(a:any,b:any)=>Math.hypot(a.x-b.x,a.z-b.z),clamp:(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v))};
  const Runtime=new Function(...Object.keys(dependencies),code)(...Object.values(dependencies)),runtime=new Runtime();
  const object=(id:string,kind:WorldObjectState['kind'],tags:string[])=>({state:{id,kind,tags,position:{x:1,z:0},resourceAmount:10},mesh:{visible:true}});
  const water=object('water','water_patch',['water','nature','habitat']),food=object('food','bush',['nature','forage']);
  const animal={state:{id:'animal',species:speciesName,position:{x:0,z:0},chunkId:'chunk',hunger:80,thirst:80,energy:70,currentAction:action,targetObjectId:undefined as string|undefined},path:[],pathIndex:0,actionResolved:false};
  Object.assign(runtime,{randomness:random.readWorldRandomness(undefined),objects:new Map([['water',water],['food',food]]),wildlife:new Map(),
    coarseWorld:{chunks:new Map([['chunk',{plants:{grass:50,shrub:50,fruit:50,crop:50}}]])},findPath:(_from:any,to:any)=>[to]});
  return {runtime,animal,water,food};
}

for(const [name,action] of [['deer','graze'],['badger','forage']] as const){
  test(`${action} rejects water during selection and proposal application`,()=>{
    const {runtime,animal,water,food}=fixture(action,name);
    assert.equal(runtime.findWildlifeResource(animal,action),food);
    runtime.applyWildlifeDecision(animal,{action,targetObjectId:'water'});
    assert.equal(animal.state.targetObjectId,'food');
    runtime.completeWildlifeAction(animal);
    assert.equal(water.state.resourceAmount,10);assert.equal(food.state.resourceAmount,9.75);assert.ok(animal.state.hunger<80);
  });
  test(`${action} completion rejects a food target that became water`,()=>{
    const {runtime,animal,food}=fixture(action,name);
    runtime.applyWildlifeDecision(animal,{action,targetObjectId:'food'});
    Object.assign(food.state,{kind:'water_patch',tags:['water','nature','habitat']});
    runtime.completeWildlifeAction(animal);
    assert.equal(food.state.resourceAmount,10);assert.equal(animal.state.hunger,80);assert.equal(animal.state.currentAction,'rest');
    assert.equal(animal.state.targetObjectId,undefined);assert.equal(animal.actionResolved,true);
  });
  test(`${action} completion rejects a removed explicit target`,()=>{
    const {runtime,animal}=fixture(action,name);
    runtime.applyWildlifeDecision(animal,{action,targetObjectId:'food'});runtime.objects.delete('food');runtime.completeWildlifeAction(animal);
    assert.equal(animal.state.hunger,80);assert.equal(animal.state.currentAction,'rest');
  });
}
test('drink selects and accepts water without consuming its finite stock',()=>{
  const {runtime,animal,water}=fixture('drink');
  assert.equal(runtime.findWildlifeResource(animal,'drink'),water);
  runtime.applyWildlifeDecision(animal,{action:'drink',targetObjectId:'water'});assert.equal(animal.state.targetObjectId,'water');
  runtime.completeWildlifeAction(animal);assert.equal(animal.state.thirst,22);assert.equal(water.state.resourceAmount,10);
});
test('drink cannot complete against a water target that became food',()=>{
  const {runtime,animal,water}=fixture('drink');runtime.applyWildlifeDecision(animal,{action:'drink',targetObjectId:'water'});
  Object.assign(water.state,{kind:'bush',tags:['nature','forage']});runtime.completeWildlifeAction(animal);
  assert.equal(animal.state.thirst,80);assert.equal(water.state.resourceAmount,10);assert.equal(animal.state.currentAction,'rest');
});
