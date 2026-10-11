import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';

const require=createRequire(new URL('../src/main.ts',import.meta.url));
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source.replace(/new TownGame\(\);\s*$/,'return {TownGame,ui};'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}
}).outputText;
const near=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);

async function fixture(){
  const w=new JSDOM('<html><body><div id="app"></div></body></html>',{url:'https://latticefolk.test',pretendToBeVisual:true}).window;
  const document=w.document as Document;
  let time=0,focused=true,hidden=false,lockElement:Element|null=null,renderCalls=0;
  const scheduled:Array<()=>void>=[],steps:number[]=[],coarseSteps:number[]=[],npcSteps:number[]=[],wildlifeSteps:number[]=[];
  Object.defineProperties(document,{hidden:{get:()=>hidden},hasFocus:{value:()=>focused},pointerLockElement:{get:()=>lockElement},
    exitPointerLock:{value:()=>{lockElement=null;document.dispatchEvent(new w.Event('pointerlockchange'));}}});
  class Renderer {
    domElement=document.createElement('canvas');shadowMap={};
    constructor(){this.domElement.requestPointerLock=()=>{lockElement=this.domElement;document.dispatchEvent(new w.Event('pointerlockchange'));return Promise.resolve();};}
    setPixelRatio(){}setSize(){}render(){renderCalls++;}
  }
  const dependencies={require:(name:string)=>name==='three'?{...THREE,WebGLRenderer:Renderer,Clock:new Function('performance',`return ${THREE.Clock.toString()}`)({now:()=>time})}:name.endsWith('.css')?{}:require(name),
    exports:{},window:w,document,localStorage:w.localStorage,navigator:w.navigator,innerWidth:1440,innerHeight:900,devicePixelRatio:1,
    addEventListener:w.addEventListener.bind(w),performance:{now:()=>time},requestAnimationFrame:(fn:()=>void)=>{scheduled.push(fn);return scheduled.length;},
    setTimeout:()=>0,clearTimeout:()=>{},fetch:()=>{throw Error('unexpected network request');}};
  const {TownGame,ui}=new Function(...Object.keys(dependencies),code)(...Object.values(dependencies));
  Object.assign(TownGame.prototype,{
    async initializePersistence(this:any){this.persistenceReady=true;this.coarseWorld={update:({dt}:{dt:number})=>coarseSteps.push(dt),activeBounds:()=>({minX:-200,maxX:200,minZ:-200,maxZ:200})};},
    async loadVisualAssets(){},refreshHealth(this:any){this.lastHealthPoll=time;},async saveWorldState(this:any){this.lastPersistenceSaveAt=time;},
    updateFineChunkMaterialization(){},updateObjects(dt:number){steps.push(dt);},updateNpcs(dt:number){npcSteps.push(dt);},updateWildlife(dt:number){wildlifeSteps.push(dt);},
    updateRaycast(){},updateUi(){},updateSpeech(){},updateSelectionVisuals(){},scheduleMovablePersistence(){}
  });
  const game=new TownGame();await Promise.resolve();await Promise.resolve();
  document.querySelector<HTMLButtonElement>('#startBtn')!.click();
  const errors:unknown[]=[];w.addEventListener('error',(e:ErrorEvent)=>{errors.push(e.error);e.preventDefault();});
  const key=(type:string,code:string,repeat=false,target:EventTarget=w)=>target.dispatchEvent(new w.KeyboardEvent(type,{code,repeat,bubbles:true}));
  const frame=(at:number)=>{time=at;const callback=scheduled.shift();assert.ok(callback);callback();assert.deepEqual(errors,[]);};
  const look=(movementX:number)=>{const e=new w.MouseEvent('mousemove',{bubbles:true});Object.defineProperties(e,{movementX:{value:movementX},movementY:{value:0}});document.dispatchEvent(e);};
  return{game,ui,w,document,steps,coarseSteps,npcSteps,wildlifeSteps,errors,key,frame,look,at:(at:number)=>{time=at;},renders:()=>renderCalls,
    focus:(value:boolean)=>{focused=value;w.dispatchEvent(new w.Event(value?'focus':'blur'));},
    visible:(value:boolean)=>{hidden=!value;document.dispatchEvent(new w.Event('visibilitychange'));},
    close:()=>{game.controls.dispose();game.orbit.dispose();w.close();}};
}

test('real TownGame at 1 FPS matches 20 FPS displacement and all simulation consumers',async()=>{
  const slow=await fixture(),normal=await fixture();try{
    for(const f of [slow,normal]){f.key('keydown','KeyD');f.key('keydown','ShiftLeft');}
    for(let ms=50;ms<=10_000;ms+=50)normal.frame(ms);
    for(let ms=1000;ms<=10_000;ms+=1000)slow.frame(ms);
    for(const f of [slow,normal]){
      f.key('keyup','ShiftLeft');f.key('keyup','KeyD');near(f.game.playerInputSeconds,10);near(f.game.playerPosition.x,72);
      near(f.game.minuteOfDay,8*60+15+22);near(f.steps.reduce((a,b)=>a+b,0),10);
      assert.deepEqual(f.steps,f.coarseSteps);assert.deepEqual(f.steps,f.npcSteps);assert.deepEqual(f.steps,f.wildlifeSteps);
      assert.ok(f.steps.every(dt=>dt>0&&dt<=.05));
    }
    near(slow.game.playerPosition.z,normal.game.playerPosition.z);
    assert.equal(slow.renders(),11);assert.equal(normal.renders(),201);
  }finally{slow.close();normal.close();}
});

test('real key press and release wholly between frames moves for exactly 800 ms once',async()=>{
  const f=await fixture();try{
    f.at(100);f.key('keydown','KeyD');f.at(900);f.key('keyup','KeyD');f.frame(1000);
    near(f.game.playerPosition.x,3.6);near(f.game.playerInputSeconds,.8);near(f.game.playerPosition.z,7);
    f.frame(2000);near(f.game.playerPosition.x,3.6);near(f.game.playerInputSeconds,.8);
  }finally{f.close();}
});

test('real Shift edges and opposing inputs keep their exact durations and original speed',async()=>{
  const f=await fixture();try{
    f.key('keydown','KeyD');f.at(200);f.key('keydown','ShiftLeft');f.at(400);f.key('keyup','ShiftLeft');
    f.at(500);f.key('keydown','KeyA');f.at(700);f.key('keyup','KeyA');f.at(900);f.key('keyup','KeyD');f.frame(1000);
    near(f.game.playerPosition.x,.5*4.5+.2*7.2);near(f.game.playerInputSeconds,.7);
  }finally{f.close();}
});

test('real pointer-look events do not retroactively rotate earlier buffered movement',async()=>{
  const f=await fixture();try{
    f.key('keydown','KeyW');f.at(400);f.look(-Math.PI/2/.002);f.at(800);f.key('keyup','KeyW');f.frame(1000);
    near(f.game.playerPosition.x,-1.8);near(f.game.playerPosition.z,5.2);near(f.game.playerInputSeconds,.8);
  }finally{f.close();}
});

for(const collider of ['static','door','npc','cart'] as const)test(`one-second sprint uses real ${collider} collision without tunnelling`,async()=>{
  const f=await fixture();try{
    if(collider==='static')f.game.physics.registerStatic({id:'thin-wall',minX:2,maxX:2.02,minZ:5,maxZ:9});
    if(collider==='door')f.game.physics.registerDoor({id:'door',minX:2,maxX:2.02,minZ:5,maxZ:9,open:false});
    if(collider==='npc'){
      const mesh=new THREE.Group();mesh.position.set(2,0,7);
      f.game.npcs.set('blocker',{state:{id:'blocker'},mesh,characterAsset:'female1'});
    }
    if(collider==='cart'){
      const mesh=new THREE.Group();mesh.position.set(2,0,7);
      f.game.objects.set('cart',{state:{id:'cart',kind:'cart',rigidBodyArchetype:'cart',position:{x:2,z:7}},mesh});
      f.game.physics.registerStatic({id:'cart-wall',minX:4,maxX:4.02,minZ:5,maxZ:9});
    }
    f.key('keydown','KeyD');f.key('keydown','ShiftLeft');f.frame(1000);
    near(f.game.playerInputSeconds,1);assert.ok(f.game.playerPosition.x>0);
    assert.ok(f.game.playerPosition.x<(collider==='cart'?2.7:1.7));
    assert.equal(f.game.physics.isBlocked(f.game.playerPosition.x,f.game.playerPosition.z,.3),false);
    if(collider==='npc')assert.ok(f.game.playerBlockedNpcs.has('npc:blocker'));
    if(collider==='cart'){
      const cart=f.game.objects.get('cart');assert.ok(cart.state.position.x>2,'actual contact pushes the cart');
      assert.ok(cart.state.position.x<4,'the pushed cart cannot cross the wall');assert.equal(f.game.movableDirty,true);
    }
  }finally{f.close();}
});

for(const boundary of ['blur','hidden','unlock','admin','menu','mode','input','textarea','select','editable'] as const)test(`${boundary} cancels buffered player motion and requires a fresh press`,async()=>{
  const f=await fixture();try{
    f.key('keydown','KeyD');f.at(200);
    if(boundary==='blur'){f.focus(false);f.at(400);f.focus(true);}
    if(boundary==='hidden'){f.visible(false);f.at(400);f.visible(true);}
    if(boundary==='unlock'){f.game.controls.unlock();f.game.controls.lock();}
    if(boundary==='admin'){f.key('keydown','Tab');f.key('keydown','Tab');}
    if(boundary==='menu'){f.game.openInteractionMenu({state:{id:'box',kind:'container',tags:[]}},[]);f.game.closeInteractionMenu(true);}
    if(boundary==='mode'){f.game.enterGodMode();f.game.enterFirstPerson();}
    if(['input','textarea','select','editable'].includes(boundary)){
      const element=f.document.createElement(boundary==='editable'?'div':boundary);element.tabIndex=0;
      if(boundary==='editable')Object.defineProperty(element,'isContentEditable',{value:true});
      f.document.body.append(element);element.focus();element.blur();
    }
    f.at(700);f.key('keydown','KeyD',true);f.at(800);f.key('keyup','KeyD');f.frame(1000);
    near(f.game.playerPosition.x,0);near(f.game.playerInputSeconds,0);
    f.at(1100);f.key('keydown','KeyD');f.at(1200);f.key('keyup','KeyD');f.frame(1300);
    near(f.game.playerPosition.x,.45);near(f.game.playerInputSeconds,.1);assert.deepEqual(f.errors,[]);
  }finally{f.close();}
});

test('multi-second foreground rendering keeps held input and drains chronological debt',async()=>{
  const f=await fixture();try{
    f.key('keydown','KeyD');f.frame(5000);near(f.game.playerPosition.x,9);near(f.game.playerInputSeconds,2);
    near(f.game.simulationClock.diagnostics.pendingSeconds,3);assert.equal(f.game.keys.has('KeyD'),true);
    f.key('keyup','KeyD');f.frame(5050);near(f.game.playerPosition.x,18);near(f.game.simulationClock.diagnostics.pendingSeconds,1.05);
    f.frame(5100);near(f.game.playerPosition.x,22.5);near(f.game.playerInputSeconds,5);near(f.game.simulationClock.diagnostics.pendingSeconds,0);
    near(f.game.minuteOfDay,495+5.1*2.2);assert.ok(f.steps.every(dt=>dt>0&&dt<=.05));
  }finally{f.close();}
});

test('genuine background pause cancels debt, and resume never replays hidden time or old input',async()=>{
  const f=await fixture();try{
    f.key('keydown','KeyD');f.frame(5000);near(f.game.playerPosition.x,9);
    f.at(5100);f.focus(false);f.frame(100_000);near(f.game.playerPosition.x,9);
    f.at(100_100);f.focus(true);f.frame(100_200);const resumed=f.game.minuteOfDay;
    f.at(100_250);f.key('keydown','KeyD',true);f.frame(100_300);near(f.game.playerPosition.x,9);
    f.at(100_350);f.key('keydown','KeyD');f.at(100_450);f.key('keyup','KeyD');f.frame(100_500);
    near(f.game.playerPosition.x,9.45);near(f.game.playerInputSeconds,2.1);near(f.game.minuteOfDay-resumed,.3*2.2);
  }finally{f.close();}
});

for(const scenario of ['rejected-down','held-release','multiple-keys','blur-reentry'] as const)test(`real input queue overflow: ${scenario} cannot leave movement stuck`,async()=>{
  const f=await fixture();try{
    f.key('keydown','KeyD');if(scenario==='multiple-keys')f.key('keydown','KeyW');
    for(let at=1;at<=254;at++){f.at(at);f.look(.001);}
    assert.equal(f.game.simulationClock.diagnostics.inputOverflowCount,0);
    f.at(255);
    if(scenario==='held-release')f.key('keyup','KeyD');
    else f.key('keydown','ShiftLeft');
    assert.equal(f.game.simulationClock.diagnostics.inputOverflowCount,1);
    assert.equal(f.game.keys.size,0);
    f.at(256);f.key('keyup','ShiftLeft');f.key('keyup','KeyW');f.key('keyup','KeyD');
    f.at(260);f.key('keydown','KeyD',true);
    if(scenario==='blur-reentry'){
      f.focus(false);f.at(500);f.focus(true);f.frame(1000);
      near(f.game.playerInputSeconds,0);near(f.game.playerPosition.x,0);near(f.game.playerPosition.z,7);
    }else{
      f.frame(1000);near(f.game.playerInputSeconds,.255);
      near(f.steps.reduce((n,dt)=>n+dt,0),1);
      const position={...f.game.playerPosition};f.frame(1050);assert.deepEqual(f.game.playerPosition,position);
    }
    assert.equal(f.game.simulationClock.diagnostics.inputOverflowCount,1,'diagnosis survives draining or pause');
    const before={...f.game.playerPosition},inputBefore=f.game.playerInputSeconds;
    f.at(1100);f.key('keydown','KeyD');f.at(1200);f.key('keyup','KeyD');f.frame(1300);
    near(Math.hypot(f.game.playerPosition.x-before.x,f.game.playerPosition.z-before.z),.45);
    near(f.game.playerInputSeconds-inputBefore,.1);assert.deepEqual(f.errors,[]);
  }finally{f.close();}
});
