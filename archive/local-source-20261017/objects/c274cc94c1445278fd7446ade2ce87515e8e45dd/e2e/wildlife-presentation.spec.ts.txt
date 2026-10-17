
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
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

const status=(page:Page)=>page.locator('#worldStatus');
const chunkAt=(v:number)=>Math.floor((v+12)/24);

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

  const player={x:-48,z:-188};
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
      base('raccoon_e2e','raccoon',-48,-191),
      base('rabbit_e2e','rabbit',-46,-191)
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
  }))).toMatchObject({x:-48,z:-188});

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
  expect(Math.hypot(raccoon.position.x-48,raccoon.position.z-52)).toBeLessThan(10);
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
