import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {bakingWorkApproach} from '../src/world/npcWorkApproach.js';
import {NPC_BODY_RADIUS} from '../src/world/characterContact.js';
import {isBakingOven} from '../src/scene/bakingOven.js';
const source=ts.createSourceFile('main.ts',fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const cls=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='TownGame') as ts.ClassDeclaration;
const method=cls.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(source)==='planNpcObjectPath')!;
const code=ts.transpileModule(`return class {${method.getText(source)}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const Runtime=new Function('bakingWorkApproach','NPC_BODY_RADIUS','isBakingOven','dist',code)(bakingWorkApproach,NPC_BODY_RADIUS,isBakingOven,(a:any,b:any)=>Math.hypot(a.x-b.x,a.z-b.z));
const collider={id:'object:unit_1_0_bakery',minX:49.16982752471488,maxX:50.43017247528508,minZ:-5.507765401424031,maxZ:-4.692234598575968};
const obj={state:{id:'unit_1_0_bakery',kind:'workstation',tags:['oven','baker','bread'],position:{x:49.8,z:-5.1}},mesh:{userData:{ovenPhysics:{collider}}}};
const agent=(id:string,x=55,z=0):any=>({state:{id},characterAsset:'female1',mesh:{position:{x,z}},path:[],pathIndex:0,task:{action:'work',targetObjectId:obj.state.id}});
const fixture=()=>Object.assign(new Runtime(),{npcs:new Map(),physics:{isBlocked:()=>false},findPath:(_from:any,to:any)=>[{x:Math.round(to.x),z:Math.round(to.z)}]});
test('real planner reserves distinct oven stances and refuses a third arrival without work',()=>{
 const game=fixture(),a=agent('a'),b=agent('b'),c=agent('c');for(const v of [a,b,c])game.npcs.set(v.state.id,v);
 game.planNpcObjectPath(a,a.task,obj);game.planNpcObjectPath(b,b.task,obj);game.planNpcObjectPath(c,c.task,obj);
 assert.ok(a.task?.approach);assert.ok(b.task?.approach);assert.notEqual(a.task.approach.x,b.task.approach.x);
 assert.equal(c.task,undefined);assert.deepEqual(c.path,[]);
});
test('existing idle occupant blocks a stance while removed actors and the caller do not',()=>{
 const game=fixture(),a=agent('a');game.npcs.set('a',a);game.planNpcObjectPath(a,a.task,obj);const stance=a.task.approach;
 a.mesh.position={x:stance.x,z:stance.z};game.planNpcObjectPath(a,a.task,obj);assert.equal(a.task.approach.x,stance.x);
 a.task=undefined;const b=agent('b');game.npcs.set('b',b);game.planNpcObjectPath(b,b.task,obj);assert.notEqual(b.task.approach.x,stance.x);
 a.removed=true;b.task={action:'work',targetObjectId:obj.state.id};game.planNpcObjectPath(b,b.task,obj);assert.equal(b.task.approach.x,stance.x);
});
