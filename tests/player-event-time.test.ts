import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import {SimulationClock} from '../src/world/simulationClock.js';
const source=fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const methods:string[]=[];
function visit(node:ts.Node){if(ts.isMethodDeclaration(node)&&['playerMovementKey','recordPlayerInput'].includes(node.name.getText(ast)))methods.push(node.getText(ast));ts.forEachChild(node,visit);}visit(ast);
const code=ts.transpileModule(`return class Runtime {${methods.join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(){
 let time=0,accepted=0;
 const Runtime=new Function('THREE','now',code)(THREE,()=>time),r=new Runtime();
 Object.assign(r,{keys:new Set<string>(),camera:new THREE.PerspectiveCamera(),persistenceReady:true,simulationClock:new SimulationClock(),playerInputAllowed:()=>true,resetPlayerInput(){this.keys.clear();this.simulationClock.clearInput();}});
 const frame=(at:number)=>{time=at;r.simulationClock.advance(at,(dt:number,input:unknown)=>{if(input)accepted+=dt;});};
 return {r,frame,at:(at:number)=>{time=at;},get accepted(){return accepted;}};
}
test('actual player methods retain a delayed native press interval before the next simulation frame',()=>{
 const f=fixture();f.frame(60000);f.at(64480);f.r.playerMovementKey('KeyW',true,false,62472.8);f.at(64480.1);f.r.playerMovementKey('KeyW',false,false,62715.3);
 f.frame(64780.1);f.frame(65000);f.frame(65100);assert.ok(Math.abs(f.accepted-.2425)<1e-9,`accepted ${f.accepted}`);
});
test('delayed events cannot replay input before already consumed simulation time',()=>{
 const f=fixture();f.frame(0);f.frame(1000);f.at(1500);f.r.playerMovementKey('KeyD',true,false,800);f.at(1500.1);f.r.playerMovementKey('KeyD',false,false,1250);f.frame(1600);
 assert.ok(Math.abs(f.accepted-.25)<1e-9);assert.equal(f.r.simulationClock.diagnostics.resetReason,'none');
});
for(const eventAt of [NaN,Infinity,-1,5000])test(`invalid or future event time ${eventAt} falls back to handling time`,()=>{
 const f=fixture();f.frame(0);f.at(100);f.r.playerMovementKey('KeyD',true,false,eventAt);f.at(350);f.r.playerMovementKey('KeyD',false,false,eventAt);f.frame(400);
 assert.ok(Math.abs(f.accepted-.25)<1e-9);
});
test('non-native input retains handling timestamps',()=>{
 const f=fixture();f.frame(0);f.at(100);f.r.playerMovementKey('KeyD',true);f.at(350);f.r.playerMovementKey('KeyD',false);f.frame(400);assert.ok(Math.abs(f.accepted-.25)<1e-9);
});

test('input after suspension cannot recover a pre-suspension interval',()=>{
 const f=fixture();f.frame(0);f.r.simulationClock.reset();f.at(2000);f.r.playerMovementKey('KeyD',true,false,100);f.at(2250);f.r.playerMovementKey('KeyD',false,false,2250);f.frame(2300);assert.ok(Math.abs(f.accepted-.25)<1e-9);
});
test('an intervening heading sample prevents a delayed key edge from reordering accepted state',()=>{
 const f=fixture();f.frame(0);f.at(100);f.r.playerMovementKey('KeyD',true,false,100);f.at(200);f.r.camera.rotation.y=1;f.r.recordPlayerInput();f.at(400);f.r.playerMovementKey('KeyD',false,false,150);f.frame(500);
 assert.ok(Math.abs(f.accepted-.1)<1e-9);assert.equal(f.r.simulationClock.diagnostics.resetReason,'none');
});
test('native event timestamps are forwarded by both keyboard listeners',()=>{
 assert.ok(source.includes('this.playerMovementKey(e.code,true,e.repeat,e.isTrusted?e.timeStamp:undefined)'));
 assert.ok(source.includes('this.playerMovementKey(e.code,false,false,e.isTrusted?e.timeStamp:undefined)'));
});
