import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';

const main=fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',main,ts.ScriptTarget.Latest,true);
let update:ts.MethodDeclaration|undefined;
const visit=(node:ts.Node)=>{if(ts.isMethodDeclaration(node)&&node.name.getText(ast)==='updatePlayer')update=node;ts.forEachChild(node,visit);};visit(ast);
assert.ok(update?.body);
const source=ts.transpileModule(`function ${update.getText(ast)}\nupdatePlayer;`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const run=vm.runInNewContext(source,{THREE}) as (this:ReturnType<typeof state>,dt:number)=>void;
function state(){
 const calls:number[]=[];const camera=new THREE.PerspectiveCamera();camera.position.set(0,1.7,0);
 return {interactionOpen:false,controls:{isLocked:true},keys:new Set<string>(),camera,firstPersonRotation:new THREE.Euler(),playerPosition:{x:0,z:0},playerInputSeconds:0,
  npcs:new Map(),playerTravel:undefined as undefined|{x:number;z:number},playerBlockedNpcs:new Set<string>(),physicsDynamicColliders:()=>[],groundHeightAt:()=>0,
  physics:{moveKinematic:(input:{position:{x:number;z:number};displacement:{x:number;z:number}})=>{calls.push(Math.hypot(input.displacement.x,input.displacement.z));return {position:{x:input.position.x+input.displacement.x,z:input.position.z+input.displacement.z},dynamicHits:[] as string[]};}},tryPushMovableObject:()=>false,calls};
}
for(const reason of ['interaction','unlocked','no-keys','opposed-keys'] as const)test(`input observation stays unchanged for ${reason}`,()=>{
 const s=state();if(reason==='interaction'){s.interactionOpen=true;s.keys.add('KeyW');}if(reason==='unlocked'){s.controls.isLocked=false;s.keys.add('KeyW');}if(reason==='opposed-keys'){s.keys.add('KeyW');s.keys.add('KeyS');}
 run.call(s,.05);assert.equal(s.playerInputSeconds,0);assert.deepEqual(s.calls,[]);
});
test('actual updatePlayer counts its supplied dt once per active physical step',()=>{
 const s=state();s.keys.add('KeyD');s.keys.add('ShiftLeft');run.call(s,.017);run.call(s,.05);
 assert.equal(s.playerInputSeconds,.067);assert.equal(s.calls.length,2);assert.ok(Math.abs(s.calls[0]-7.2*.017)<1e-12);assert.ok(Math.abs(s.calls[1]-7.2*.05)<1e-12);
});
test('blocked displacement still counts an attempted physical input step',()=>{
 const s=state();s.keys.add('KeyW');s.physics.moveKinematic=input=>({position:{...input.position},dynamicHits:['npc:blocked']});run.call(s,.05);
 assert.equal(s.playerInputSeconds,.05);assert.equal(s.playerPosition.z,0);assert.ok(s.playerBlockedNpcs.has('npc:blocked'));
});
test('movable push retry does not count the same dt twice',()=>{
 const s=state();s.keys.add('KeyD');let calls=0;s.physics.moveKinematic=input=>{calls++;return {position:{...input.position},dynamicHits:calls===1?['object:cart']:[]};};s.tryPushMovableObject=()=>true;run.call(s,.05);
 assert.equal(calls,2);assert.equal(s.playerInputSeconds,.05);
});
test('observation is exposed through existing read-only diagnostics',()=>{
 assert.equal((main.match(/playerInputSeconds/g)??[]).length,4);
 assert.match(main,/ui\.world\.dataset\.playerInputSeconds=String\(this\.playerInputSeconds\);/);
 assert.ok(main.includes('this.simulationClock.advance(now(),(dt,input)=>this.simulateStep(dt,input))'));
 assert.ok(main.includes('this.updatePlayer(dt,input??'));
});
