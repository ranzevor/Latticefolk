
import { test, expect, type Page, type APIRequestContext } from './helpers/native-input-probe.js';
import * as THREE from 'three';
import { CoarseWorldRuntime } from '../src/world/coarseWorld.js';
import { planFineChunk } from '../src/world/materialization.js';
import type {
  WorldPersistenceSnapshot,
  WildlifeState,
  WildlifeDecisionBatchRequest,
  WildlifeDecisionBatchResponse,
  WildlifeDecisionResult,
  WildlifeAction,
} from '../src/types.js';
import { startFirstPerson } from './helpers/native-start.js';
import {driveNativeWaypoint} from './helpers/native-waypoint.js';

const status=(page:Page)=>page.locator('#worldStatus');
const chunkAt=(v:number)=>Math.floor((v+12)/24);
const WILDLIFE_FIXTURE_PLAYER={x:-48,z:-188} as const;
const WILDLIFE_FIXTURE_RACCOON={x:-48,z:-191} as const;
const WILDLIFE_FIXTURE_RABBIT={x:-46,z:-191} as const;


type WildlifeVisual = {
  id:string;
  species:string;
  position:{x:number;z:number};
  ready:boolean;
  bones:number;
  meshes:number;
  pose:number[];
  action:string;
};

async function frameRaccoon(page:Page, previousHeading:number, id:string):Promise<number> {
  return await page.evaluate(async ({actorId, previousHeading}) => {
    const status=document.querySelector('#worldStatus') as HTMLElement;
    const playerX=Number(status.dataset.playerX);
    const playerZ=Number(status.dataset.playerZ);
    const visuals=JSON.parse(status.dataset.wildlifeVisuals||'[]') as Array<{
      id:string;position:{x:number;z:number};meshes:number;bones:number;
    }>;

    const actor=visuals.find(v=>v.id===actorId);
    const rabbit=visuals.find(v=>v.id==='rabbit_e2e');
    if(!actor||!rabbit) throw new Error('wildlife visuals missing');
    if(actor.meshes<=0||actor.bones<=0||rabbit.meshes<=0) {
      throw new Error('wildlife visual unavailable');
    }

    const actorDistance=Math.hypot(
      actor.position.x-playerX,
      actor.position.z-playerZ,
    );
    const rabbitDistance=Math.hypot(
      rabbit.position.x-playerX,
      rabbit.position.z-playerZ,
    );
    if(actorDistance>12||rabbitDistance>12) {
      throw new Error('wildlife out of capture range');
    }

    const canvas=document.querySelector('canvas');
    if(!canvas||document.pointerLockElement!==canvas) {
      throw new Error('pointer lock unavailable');
    }

    const dx=actor.position.x-playerX;
    const dz=actor.position.z-playerZ;
    const nextHeading=Math.atan2(dx,-dz);
    const turn=Math.atan2(
      Math.sin(nextHeading-previousHeading),
      Math.cos(nextHeading-previousHeading),
    );

    const dispatch=(movementX:number,movementY:number)=>{
      const event=new MouseEvent('mousemove',{bubbles:true});
      Object.defineProperties(event,{
        movementX:{value:movementX},
        movementY:{value:movementY},
      });
      canvas.dispatchEvent(event);
    };

    dispatch(turn/.002,0);

    const pitch=Math.atan2(1.7-.237,actorDistance);
    dispatch(0,2000);
    dispatch(0,(pitch-Math.PI/2)/.002);

    await new Promise<void>(resolve=>{
      requestAnimationFrame(()=>{
        requestAnimationFrame(()=>resolve());
      });
    });

    return nextHeading;
  }, {actorId:id, previousHeading});
}

async function seedWildlife(request:APIRequestContext){
  const deleted=await request.delete('/api/world/state');
  expect(deleted.ok()).toBeTruthy();
  const revision=(await deleted.json()).revision;

  const player=WILDLIFE_FIXTURE_PLAYER;
  const chunkId='chunk_-2_-8';

  const coarse=new CoarseWorldRuntime(new THREE.Scene());
  const chunk=coarse.ensureChunk(-2,-8);
  if(!chunk) throw new Error('missing natural coarse chunk');
  const plan=planFineChunk(chunk,coarse.chunkSize);

  expect(chunk.id).toBe(chunkId);
  expect(chunk.settlementLevel).toBe(0);
  expect(plan.archetype).toBe('wilderness');
  expect(plan.residents).toHaveLength(0);
  expect(plan.buildings).toHaveLength(0);
  expect(plan.roads).toHaveLength(0);

  const base=(id:string,species:'raccoon'|'rabbit',x:number,z:number):WildlifeState=>({
    id,chunkId,species,position:{x,z},
    ageDays:20,health:100,hunger:0,thirst:0,energy:100,sex:'male',
    generation:1,traits:{size:.58,speed:1,fertility:1,wariness:1},
    currentAction:'rest',lastDecisionAt:0,birthDay:0
  });

  const snapshot:WorldPersistenceSnapshot={
    version:1,
    meta:{day:1,minuteOfDay:495,weather:'clear',playerPosition:player,
      playerInventory:{apple:0,bread:0,wood:0,coin:10,flower:0,grain:0,flour:0,water:0,stone:0,plank:0,tool:0}},
    coarseChunks:[structuredClone(chunk)],
    fineChunks:[{chunkId,npcStates:[],objectStates:[],wildlifeStates:[
      base('raccoon_e2e','raccoon',WILDLIFE_FIXTURE_RACCOON.x,WILDLIFE_FIXTURE_RACCOON.z),
      base('rabbit_e2e','rabbit',WILDLIFE_FIXTURE_RABBIT.x,WILDLIFE_FIXTURE_RABBIT.z)
    ]}],
    homeNpcs:[],homeObjects:[]
  };
  const result=await request.post('/api/world/state',{data:{expectedRevision:revision,snapshot}});
  expect(result.ok()).toBeTruthy();
}

test.afterEach(async({page,request})=>{
  await page.close();
  const deleted=await request.delete('/api/world/state');
  expect(deleted.ok()).toBeTruthy();
});

test('raccoon decision driven movement and presentation capture',async({page,request},info)=>{
  test.setTimeout(180_000);
  let moveRequested=false;
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));

  await page.route('**/api/wildlife/decide',async route=>{
    const body=route.request().postDataJSON() as WildlifeDecisionBatchRequest;
    const decisions: WildlifeDecisionResult[]=body.requests.map(item=>{
      const action: WildlifeAction=item.wildlife.id==='raccoon_e2e'&&moveRequested?'wander':'rest';
      expect(item.allowedActions).toContain(action);
      return {wildlifeId:item.wildlife.id,action,source:'e2e',confidence:1,reasonCode:'fixture'};
    });
    const response:WildlifeDecisionBatchResponse={source:'e2e',decisions};
    await route.fulfill({json:response});
  });

  await page.addInitScript(()=>localStorage.setItem('latticefolk.locale','en'));
  await seedWildlife(request);
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect.poll(async()=>await status(page).evaluate((el:HTMLElement)=>({
    x:Number(el.dataset.playerX),
    z:Number(el.dataset.playerZ)
  }))).toMatchObject(WILDLIFE_FIXTURE_PLAYER);

  await expect.poll(async()=>Number(await status(page).evaluate((el:HTMLElement)=>el.dataset.materializedChunks||0))).toBeGreaterThan(0);

  await startFirstPerson(page);

  const visuals=()=>status(page).evaluate((el:HTMLElement)=>JSON.parse(el.dataset.wildlifeVisuals||'[]') as WildlifeVisual[]);
  const current=async(id:string, predicate:(visual:WildlifeVisual)=>boolean)=>{
    await expect.poll(async()=>{
      const visual=(await visuals()).find(v=>v.id===id);
      return visual ? predicate(visual) : false;
    }).toBeTruthy();
    const visual=(await visuals()).find(v=>v.id===id);
    if(!visual) throw new Error(`missing wildlife visual ${id}`);
    return visual;
  };

  const raccoon=await current('raccoon_e2e',v=>v.ready&&v.meshes>0&&v.bones>0);
  const rabbit=await current('rabbit_e2e',v=>v.meshes>0);
  await expect.poll(()=>raccoon.ready&&raccoon.bones>0).toBeTruthy();
  expect(rabbit.meshes).toBeGreaterThan(0);

  moveRequested=false;
  const heading1=await frameRaccoon(page,0,'raccoon_e2e');
  expect(Math.hypot(raccoon.position.x-WILDLIFE_FIXTURE_PLAYER.x,raccoon.position.z-WILDLIFE_FIXTURE_PLAYER.z)).toBeLessThan(10);
  const close=await page.screenshot();
  await info.attach('raccoon-close.png',{body:close,contentType:'image/png'});

  const start=(await visuals()).find(v=>v.id==='raccoon_e2e')!;
  moveRequested=true;
  await expect.poll(async()=>{
    const r=(await visuals()).find(v=>v.id==='raccoon_e2e')!;
    return Math.hypot(r.position.x-start.position.x,r.position.z-start.position.z);
  },{timeout:60000}).toBeGreaterThan(.15);

  const moved=(await visuals()).find(v=>v.id==='raccoon_e2e')!;
  expect(moved.pose).not.toEqual(start.pose);
  const heading2=await frameRaccoon(page,heading1,'raccoon_e2e');
  const walk=await page.screenshot();
  await info.attach('raccoon-walking.png',{body:walk,contentType:'image/png'});

  const godBefore=await status(page).evaluate((el:HTMLElement)=>({d:el.dataset.discoveredChunks,m:el.dataset.materializedChunks}));
  await page.keyboard.press('g');
  await expect(status(page)).toHaveAttribute('data-camera-mode','god');
  await page.mouse.move(400,300);
  await page.mouse.wheel(0,-500);
  await page.waitForTimeout(300);
  const godAfter=await status(page).evaluate((el:HTMLElement)=>({d:el.dataset.discoveredChunks,m:el.dataset.materializedChunks}));
  expect(godAfter).toEqual(godBefore);
  expect(await status(page).getAttribute('data-asset-failures')).toBe('0');
  expect(await status(page).getAttribute('data-wildlife-raccoon-failed')).toBe('0');
  expect(errors).toEqual([]);
});

// Read live scene groups through the already-loaded Three module. No game
// reference, model, input counter or simulation state is exposed or changed.
async function knownActorViews(page:Page,ids:string[]){
  const session=await page.context().newCDPSession(page);
  try{
    const prototype=await session.send('Runtime.evaluate',{objectGroup:'known-actors',awaitPromise:true,expression:`(async()=>{
      const url=performance.getEntriesByType('resource').map(entry=>entry.name).find(name=>{
        const value=new URL(name);return value.origin===location.origin&&/\\/node_modules\\/\\.vite\\/deps\\/three\\.js$/.test(value.pathname);
      });return url?(await import(url)).Group.prototype:null;
    })()`});
    if(prototype.exceptionDetails||!prototype.result.objectId)throw new Error('Loaded Three Group prototype unavailable');
    const groups=await session.send('Runtime.queryObjects',{prototypeObjectId:prototype.result.objectId,objectGroup:'known-actors'});
    const result=await session.send('Runtime.callFunctionOn',{objectId:groups.objects.objectId,returnByValue:true,arguments:[{value:ids}],functionDeclaration:`function(ids){
      return this.filter(group=>ids.includes(group.userData.entityId)&&group.parent?.isScene).map(group=>{
        const meshes=[];group.traverse(node=>{if(node.isMesh)meshes.push(node.uuid);});
        return {id:group.userData.entityId,uuid:group.uuid,visible:group.visible,position:{x:group.position.x,z:group.position.z},meshes};
      }).sort((a,b)=>a.id.localeCompare(b.id));
    }`});
    if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);
    return result.result.value as {id:string;uuid:string;visible:boolean;position:{x:number;z:number};meshes:string[]}[];
  }finally{
    await session.send('Runtime.releaseObjectGroup',{objectGroup:'known-actors'}).catch(()=>{});
    await session.detach().catch(()=>{});
  }
}

test('saved actors stay visible across an internal owner boundary and reload without expanding fine simulation',async({page,request},info)=>{
  test.setTimeout(180_000);
  const clear=await request.delete('/api/world/state');expect(clear.ok()).toBe(true);
  const {revision}=await clear.json(),owner='chunk_2_0',ids=['chunk_2_0_npc_0','known_raccoon'];
  const snapshot:WorldPersistenceSnapshot={version:1,meta:{day:1,minuteOfDay:495,weather:'clear',weatherEpoch:1,playerPosition:{x:61,z:0},
    playerInventory:{apple:0,bread:1,wood:0,coin:10,flower:0,grain:0,flour:0,water:0,stone:0,plank:0,tool:0}},
    coarseChunks:Array.from({length:9},(_,i)=>{const cx=2+i%3,cz=Math.floor(i/3)-1;return{id:`chunk_${cx}_${cz}`,cx,cz,biome:'plains',settlementLevel:2,population:0,
      food:65,wood:50,water:60,ecology:55,danger:10,prosperity:65,strategy:'trade_route',migrationPolicy:'retain',ecologyPolicy:'balance',lastDecisionAt:0,decisionVersion:0,wildlife:[]};}),
    fineChunks:[{chunkId:owner,npcStates:[{id:ids[0]!,chunkId:owner,name:'Known resident',role:'resident',position:{x:48,z:3},home:{x:48,z:3},
      mood:'calm',hunger:0,energy:100,social:100,money:19,inventory:[{kind:'wood',count:7}],relationships:{},memories:[],currentAction:'idle',goal:'Rest',lastDecisionAt:0}],
      objectStates:[],wildlifeStates:[{id:ids[1]!,chunkId:owner,species:'raccoon',position:{x:50,z:-3},ageDays:20,health:100,hunger:0,thirst:0,energy:100,sex:'male',
        generation:1,traits:{size:.58,speed:1,fertility:1,wariness:1},currentAction:'rest',lastDecisionAt:0,birthDay:0}]},
      {chunkId:'chunk_3_0',npcStates:[],objectStates:[],wildlifeStates:[]}],homeNpcs:[],homeObjects:[]};
  const seed=await request.post('/api/world/state',{data:{snapshot,expectedRevision:revision}});expect(seed.ok()).toBe(true);
  const seededRevision=(await seed.json()).revision;
  await page.route('**/api/decision',route=>route.fulfill({json:{source:'e2e',action:'idle',stateShift:'stable',commitment:1,confidence:1,reasonCode:'fixture'}}));
  await page.route('**/api/wildlife/decide',route=>{const body=route.request().postDataJSON() as WildlifeDecisionBatchRequest;
    return route.fulfill({json:{source:'e2e',decisions:body.requests.map(item=>({wildlifeId:item.wildlife.id,action:'rest',source:'e2e',confidence:1,reasonCode:'fixture'}))}});});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('latticefolk.locale','en'));
  const active=()=>status(page).evaluate((element:HTMLElement)=>({
    npcs:(JSON.parse(element.dataset.characterSoles||'[]') as {id:string}[]).map(actor=>actor.id).filter(id=>id==='chunk_2_0_npc_0'),
    wildlife:(JSON.parse(element.dataset.wildlifeVisuals||'[]') as {id:string}[]).map(actor=>actor.id).filter(id=>id==='known_raccoon'),
    owners:(JSON.parse(element.dataset.streamedLayouts||'[]') as {unitId:string;fineOwners:string[]}[]).find(unit=>unit.unitId==='unit_1_0')?.fineOwners
  }));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(status(page)).toHaveAttribute('data-asset-failures','0',{timeout:45_000});
  await expect(status(page)).toHaveAttribute('data-wildlife-raccoon-ready','1',{timeout:45_000});
  await expect.poll(async()=>{const actors=await knownActorViews(page,ids);return actors.length===2&&actors.every(actor=>actor.meshes.length>0);},{timeout:45_000}).toBe(true);
  const before=await knownActorViews(page,ids);
  expect(before.map(actor=>actor.id)).toEqual(ids);expect(before.every(actor=>actor.visible&&actor.meshes.length>0)).toBe(true);
  expect(await active()).toEqual({npcs:[],wildlife:[],owners:['chunk_3_0']});
  await startFirstPerson(page);
  const enter=await page.evaluate(driveNativeWaypoint,{target:{x:58,z:0},timeoutMs:45_000,tolerance:.3,maxInputSeconds:2});expect(enter.reached).toBe(true);
  await expect.poll(active).toEqual({npcs:[ids[0]],wildlife:[ids[1]],owners:[owner]});
  const entered=await knownActorViews(page,ids);expect(entered).toEqual(before);
  const leave=await page.evaluate(driveNativeWaypoint,{target:{x:61,z:0},timeoutMs:45_000,tolerance:.3,maxInputSeconds:2});expect(leave.reached).toBe(true);
  await expect.poll(active).toEqual({npcs:[],wildlife:[],owners:['chunk_3_0']});
  const outside=await knownActorViews(page,ids);expect(outside).toEqual(before);
  // Turn through the ordinary pointer-lock input path to capture the retained models.
  await page.evaluate(async()=>{
    const canvas=document.querySelector('#game canvas'),data=document.querySelector<HTMLElement>('#worldStatus')!.dataset;
    if(document.pointerLockElement!==canvas||!canvas)throw new Error('Actor capture requires pointer lock');
    const heading=Math.atan2(49-Number(data.playerX),Number(data.playerZ)),yaw=Number(data.cameraYaw);
    const look=(x:number,y:number)=>{const event=new MouseEvent('mousemove',{bubbles:true});Object.defineProperties(event,{movementX:{value:x},movementY:{value:y}});canvas.dispatchEvent(event);};
    look(Math.atan2(Math.sin(yaw+heading),Math.cos(yaw+heading))/.002,0);look(0,2000);look(0,(.08-Math.PI/2)/.002);
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
  });
  await info.attach('known-actors-outside-owner',{body:await page.screenshot(),contentType:'image/png'});
  await expect.poll(async()=>{const saved=await (await request.get('/api/world/state')).json();return saved.revision>seededRevision&&saved.snapshot?.meta.playerPosition.x>60&&
    saved.snapshot.fineChunks.some((chunk:any)=>chunk.chunkId===owner&&chunk.dynamicActivated===true);},{timeout:45_000}).toBe(true);
  const saved=await (await request.get('/api/world/state')).json(),row=saved.snapshot.fineChunks.find((chunk:any)=>chunk.chunkId===owner);
  expect(row.npcStates.map((actor:any)=>actor.id)).toEqual([ids[0]]);expect(row.wildlifeStates.map((actor:any)=>actor.id)).toEqual([ids[1]]);
  expect(row.npcStates[0]).toMatchObject({money:19,inventory:[{kind:'wood',count:7}],position:before[0]!.position});
  await page.reload();await expect(status(page)).toHaveAttribute('data-wildlife-raccoon-ready','1',{timeout:45_000});
  await expect(status(page)).toHaveAttribute('data-asset-failures','0',{timeout:45_000});
  await expect.poll(async()=>{const actors=await knownActorViews(page,ids);return actors.length===2&&actors.every(actor=>actor.meshes.length>0);},{timeout:45_000}).toBe(true);
  const reloaded=await knownActorViews(page,ids);
  expect(reloaded.map(({id,visible,position,meshes})=>({id,visible,position,meshes:meshes.length})))
    .toEqual(before.map(({id,visible,position,meshes})=>({id,visible,position,meshes:meshes.length})));
  expect(await active()).toEqual({npcs:[],wildlife:[],owners:['chunk_3_0']});
  await info.attach('known-actor-boundary',{body:Buffer.from(JSON.stringify({before,entered,outside,reloaded,enter,leave,row},null,2)),contentType:'application/json'});
  expect(errors).toEqual([]);
});
