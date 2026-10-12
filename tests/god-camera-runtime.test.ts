import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {SimulationClock,isPlayerMovementKey} from '../src/world/simulationClock.js';
import {GodCameraInput,isGodCameraInputKey} from '../src/scene/godCameraInput.js';
import {SunShadowView} from '../src/scene/sunShadow.js';
import {refreshLocaleText} from '../src/ui/runtimeLocale.js';
import {visibleHudLogs} from '../src/ui/hudDiagnostics.js';
import {I18n,SUPPORTED_LOCALES} from '../src/i18n.js';
const {JSDOM}=createRequire(import.meta.url)('jsdom');
const source=fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true),methods=new Map<string,string>();
let template='',uiSource='';
function visit(n:ts.Node){
 if(ts.isBinaryExpression(n)&&n.left.getText(ast)==='app.innerHTML')template=n.right.getText(ast);
 if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='ui')uiSource=n.initializer!.getText(ast);
 if(ts.isMethodDeclaration(n))methods.set(n.name.getText(ast),n.getText(ast));
 ts.forEachChild(n,visit);
}visit(ast);
const transpile=(s:string)=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const names=['changeLocale','refreshInteractionLabels','updateLocalizedUi','renderEvolutionPanel','resetPlayerInput','resetSimulationClock','playerInputAllowed','playerMovementKey','recordPlayerInput','bindInput','resetGodCameraInput','godCameraInputAllowed','godCameraKey','updateGodCamera','applyGodCameraInput','updateCameraShadow',
 'toggleCameraMode','enterGodMode','enterFirstPerson','focusTown','focusSelected','moveGodTarget','openInteractionMenu','closeInteractionMenu'];
const code=transpile(`return class Runtime {${names.map(k=>methods.get(k)).join('\n')}}`);
// Actual input, camera, shadow and menu methods with real DOM listeners and OrbitControls.
// The renderer is never invoked here; only the existing shadow HUD assignment is published.
function fixture(){
 const i18n=new I18n('en'),html=new Function('i18n','SUPPORTED_LOCALES',`return ${template}`)(i18n,SUPPORTED_LOCALES);
 const w=new JSDOM(`<html><body><div id="app">${html}</div></body></html>`,{url:'https://latticefolk.test',pretendToBeVisual:true}).window;
 const document=w.document as Document,ui=new Function('document',transpile(`return ${uiSource}`))(document);
 let time=0,focused=true,hidden=false,renderCalls=0;
 Object.defineProperty(document,'hasFocus',{value:()=>focused});Object.defineProperty(document,'hidden',{get:()=>hidden});
 const Runtime=new Function('isPlayerMovementKey','localStorage','refreshLocaleText','visibleHudLogs','ui','document','addEventListener','THREE','i18n','isGodCameraInputKey','now','clamp',code)
  (isPlayerMovementKey,w.localStorage,refreshLocaleText,visibleHudLogs,ui,document,w.addEventListener.bind(w),THREE,i18n,isGodCameraInputKey,()=>time,(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v)));
 const r=new Runtime(),canvas=document.createElement('canvas');document.querySelector('#game')!.append(canvas);
 const camera=new THREE.PerspectiveCamera();camera.position.set(12,18,12);
 const orbit=new OrbitControls(camera,canvas);orbit.target.set(0,0,0);orbit.update();
 const events=new Map<string,()=>void>();const controls={isLocked:false,addEventListener:(name:string,fn:()=>void)=>events.set(name,fn),
  lock(){this.isLocked=true;events.get('lock')?.();},unlock(){this.isLocked=false;events.get('unlock')?.();}};
 const shadowStatement=methods.get('updateUi')!.split('\n').find(line=>line.includes('ui.world.dataset.shadowView='))!;
 Object.assign(r,{logs:[],day:1,weather:'clear',gameTimeText:()=> '08:15',worldSeason:()=> 'spring',updatePrompt(){},persistenceReady:true,camera,orbit,controls,keys:new Set(),godCameraInput:new GodCameraInput(),simulationClock:new SimulationClock(),cameraMode:'god',interactionOpen:false,
  renderer:{domElement:canvas,setSize(){},render(){renderCalls++;}},sunShadow:new SunShadowView(new THREE.DirectionalLight()),shadowFocus:new THREE.Vector3(),
  firstPersonRotation:new THREE.Euler(),playerPosition:{x:0,z:0},perceptionEpoch:0,coarseWorld:{activeBounds:()=>({minX:-36,maxX:36,minZ:-36,maxZ:36})},
  godPointer:new THREE.Vector2(),objects:new Map(),cancelPlayerTargeting(){},suspendPlayerWildlifeFollowPaths(){},toast(){},
  objectDisplayName:()=> 'box',interactionLabel:()=> 'inspect',
  updateUi:new Function('ui',transpile(`return function(){${shadowStatement}}`))(ui),
  updateFineChunkMaterialization(){throw new Error('God input must not discover or materialize');}});
 ui.overlay.classList.add('hidden');r.bindInput();r.updateCameraShadow();r.updateUi();
 const key=(type:string,code:string,repeat=false,target:EventTarget=w)=>target.dispatchEvent(new w.KeyboardEvent(type,{code,repeat,bubbles:true}));
 return {r,w,document,ui,at:(ms:number)=>{time=ms;},key,shadow:()=>JSON.parse(ui.world.dataset.shadowView),renderCalls:()=>renderCalls,
  focus:(value:boolean)=>{focused=value;w.dispatchEvent(new w.Event(value?'focus':'blur'));},
  visible:(value:boolean)=>{hidden=!value;document.dispatchEvent(new w.Event('visibilitychange'));},
  close:()=>{orbit.dispose();w.close();}};
}
test('real God key edges publish an 800ms pan before another RAF without moving the player',()=>{
 const f=fixture();try{
  const before=f.shadow(),player={...f.r.playerPosition},target=f.r.orbit.target.clone();
  f.key('keydown','KeyD');f.at(800);f.key('keyup','KeyD');
  assert.ok(Math.abs(f.r.orbit.target.distanceTo(target)-8.8)<1e-8);assert.notDeepEqual(f.shadow().focus,before.focus);
  assert.equal(f.shadow().mode,'god');assert.ok(f.shadow().halfExtent<=96);assert.equal(f.shadow().mapSize,2048);
  assert.deepEqual(f.r.playerPosition,player);assert.equal(f.renderCalls(),0);
  const released=f.r.orbit.target.clone();f.at(1000);f.r.updateGodCamera();assert.ok(f.r.orbit.target.distanceTo(released)<1e-8);
 }finally{f.close();}
});
test('frame consumption and a Shift transition preserve exact speed segments',()=>{
 const f=fixture();try{
  const start=f.r.orbit.target.clone();f.key('keydown','KeyD');f.at(200);f.r.updateGodCamera();
  f.at(300);f.key('keydown','ShiftLeft');f.at(500);f.key('keyup','ShiftLeft');f.at(800);f.key('keyup','KeyD');
  assert.ok(Math.abs(f.r.orbit.target.distanceTo(start)-(11*.6+20*.2))<1e-8);
 }finally{f.close();}
});
test('God pan stays inside the original bounds and opposing keys cancel',()=>{
 const f=fixture();try{
  const start=f.r.orbit.target.clone();f.key('keydown','KeyD');f.key('keydown','KeyA');f.at(800);f.key('keyup','KeyD');f.key('keyup','KeyA');
  assert.ok(f.r.orbit.target.distanceTo(start)<1e-8);
  f.r.orbit.target.set(35.9,0,35.9);f.r.camera.position.set(47.9,18,47.9);f.at(1000);f.key('keydown','KeyD');f.at(1800);f.key('keyup','KeyD');
  assert.ok(f.r.orbit.target.x<=36+1e-9&&f.r.orbit.target.z<=36+1e-9,JSON.stringify(f.r.orbit.target.toArray()));assert.equal(f.renderCalls(),0);
 }finally{f.close();}
});
test('combined pan and spin retain the original bounded-step path between frames',()=>{
 const sampled=fixture(),between=fixture();try{
  for(const f of [sampled,between]){f.key('keydown','KeyW');f.key('keydown','KeyQ');}
  for(let ms=50;ms<=800;ms+=50){sampled.at(ms);sampled.r.updateGodCamera();}
  between.at(800);for(const f of [sampled,between]){f.key('keyup','KeyW');f.key('keyup','KeyQ');}
  assert.ok(sampled.r.orbit.target.distanceTo(between.r.orbit.target)<1e-8);
  assert.ok(sampled.r.camera.position.distanceTo(between.r.camera.position)<1e-8);
 }finally{sampled.close();between.close();}
});
for(const boundary of ['blur','hidden','input','textarea','select','editable','admin','menu','mode','lock','unlock'] as const)test(`${boundary} clears pending God input without later leakage`,()=>{
 const f=fixture();try{
  const start=f.r.orbit.target.clone();f.key('keydown','KeyD');f.at(200);
  if(boundary==='blur'){f.focus(false);f.at(400);f.focus(true);}
  if(boundary==='hidden'){f.visible(false);f.at(400);f.visible(true);}
  if(boundary==='input'){const input=f.document.querySelector('input')!;input.focus();f.key('keydown','KeyD',true,input);input.blur();}
  if(boundary==='textarea'||boundary==='select'){const input=f.document.querySelector(boundary)!;input.focus();f.key('keydown','KeyD',true,input);input.blur();}
  if(boundary==='editable'){const input=f.document.createElement('div');input.tabIndex=0;input.contentEditable='true';Object.defineProperty(input,'isContentEditable',{value:true});f.document.body.append(input);input.focus();f.key('keydown','KeyD',true,input);input.blur();}
  if(boundary==='admin'){f.key('keydown','Tab');f.key('keydown','Tab');}
  if(boundary==='menu'){f.r.openInteractionMenu({state:{id:'box',kind:'container',tags:[]}},['inspect']);f.r.closeInteractionMenu();}
  if(boundary==='mode'){f.r.enterFirstPerson();f.r.enterGodMode();}
  if(boundary==='lock'){f.r.controls.lock();f.key('keydown','KeyD');f.r.controls.unlock();}
  if(boundary==='unlock')f.r.controls.unlock();
  f.at(700);f.key('keydown','KeyD',true);f.at(800);f.key('keyup','KeyD');f.r.updateGodCamera();
  assert.ok(f.r.orbit.target.distanceTo(start)<1e-8);assert.equal(f.renderCalls(),0);
 }finally{f.close();}
});
test('a real stale God hold does not jump or resume through repeat',()=>{
 const f=fixture();try{
  const start=f.r.orbit.target.clone();f.key('keydown','KeyD');f.at(2001);f.r.updateGodCamera();
  f.at(2100);f.key('keydown','KeyD',true);f.at(2200);f.key('keyup','KeyD');
  assert.ok(f.r.orbit.target.distanceTo(start)<1e-8);
 }finally{f.close();}
});

test('God input and locale remain safe before the selected-seed world exists',()=>{
 const f=fixture();try{
  const world=f.r.coarseWorld;f.r.coarseWorld=undefined;f.r.persistenceReady=false;f.r.cameraMode='firstPerson';
  const errors:unknown[]=[];f.w.addEventListener('error',(event:ErrorEvent)=>{errors.push(event.error);event.preventDefault();});
  f.key('keydown','KeyG');const before=f.r.orbit.target.clone();
  f.at(100);f.key('keydown','KeyD');f.at(900);f.key('keyup','KeyD');
  assert.deepEqual(f.r.orbit.target.toArray(),before.toArray());
  f.ui.localeSelect.value='ja';f.ui.localeSelect.dispatchEvent(new f.w.Event('change'));
  assert.equal(f.document.documentElement.lang,'ja');assert.equal(f.ui.evolution.classList.contains('hidden'),true);
  f.at(1000);f.key('keydown','KeyD');f.at(1800);f.r.coarseWorld=world;f.r.persistenceReady=true;f.key('keyup','KeyD');
  assert.deepEqual(f.r.orbit.target.toArray(),before.toArray(),'pre-load hold must not replay after readiness');
  f.at(1900);f.key('keydown','KeyD');f.at(2000);f.key('keyup','KeyD');
  assert.ok(Math.abs(f.r.orbit.target.distanceTo(before)-1.1)<1e-9);assert.deepEqual(errors,[]);assert.equal(f.renderCalls(),0);
 }finally{f.close();}
});
