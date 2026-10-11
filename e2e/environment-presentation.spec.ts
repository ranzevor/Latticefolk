import { test,expect,type Page,type APIRequestContext } from '@playwright/test';
import type { WorldPersistenceSnapshot, DecisionResponse } from '../src/types.js';
import type { StaticCollider,PhysicsTrigger } from '../src/world/finePhysics.js';
import { startFirstPerson } from './helpers/native-start.js';
import { lookForObject } from './helpers/relative-look.js';
import { waitForPlayerZBelow } from './helpers/frame-position.js';

interface TreeView {id:string;height:number;position:{x:number;z:number};collider:StaticCollider;trigger:PhysicsTrigger;}
interface SoleView {id:string;animation:string;vertices:number;ground:number;sole:number;position:{x:number;z:number};}
const status=(page:Page)=>page.locator('#worldStatus');
const trees=async(page:Page):Promise<TreeView[]>=>JSON.parse(await status(page).getAttribute('data-tree-presentation')??'[]');
const soles=async(page:Page):Promise<SoleView[]>=>JSON.parse(await status(page).getAttribute('data-character-soles')??'[]');
async function player(page:Page){return status(page).evaluate(el=>({x:Number((el as HTMLElement).dataset.playerX),z:Number((el as HTMLElement).dataset.playerZ)}));}
async function saved(request:APIRequestContext){const r=await request.get('/api/world/state');expect(r.ok()).toBe(true);return r.json() as Promise<{revision:number;snapshot:WorldPersistenceSnapshot}>;}
async function seed(request:APIRequestContext,position:{x:number;z:number}){
  const r=await request.delete('/api/world/state');expect(r.ok()).toBe(true);const {revision}=await r.json();
  const snapshot:WorldPersistenceSnapshot={version:1,meta:{day:1,minuteOfDay:495,weather:'clear',playerPosition:position,
    playerInventory:{apple:0,bread:0,wood:0,coin:10,flower:0,grain:0,flour:0,water:0,stone:0,plank:0,tool:0}},
    coarseChunks:[],fineChunks:[],homeNpcs:[],homeObjects:[]};
  const written=await request.post('/api/world/state',{data:{expectedRevision:revision,snapshot}});expect(written.ok()).toBe(true);
  return (await written.json()).revision as number;
}
async function pauseWithUi(page:Page){
  await page.locator('#startBtn').waitFor();
  await page.keyboard.press('Tab');
  const pause=page.locator('#pauseBtn');await expect(pause).toBeVisible();
  await pause.press('Enter');await expect(pause).toContainText('Resume');
  await page.keyboard.press('Tab');
}

test.afterEach(async({page,request})=>{await page.close();const r=await request.delete('/api/world/state');expect(r.ok()).toBe(true);});

test('adult sourced tree has reachable trunk contact, visible approach and conserved chop after reload',async({page,request},info)=>{
  test.setTimeout(240_000);
  const revision=await seed(request,{x:14,z:4.8});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  try {
    await page.addInitScript(()=>localStorage.setItem('latticefolk.locale','en'));
    await page.goto('/',{waitUntil:'domcontentloaded'});
    // Ordinary console pause isolates the resource action, without removing any NPC/body.
    await pauseWithUi(page);
    await expect.poll(async()=>(await trees(page)).some(t=>t.id==='tree_apple_2'&&!!t.collider),{timeout:45_000}).toBe(true);
    await expect(status(page)).toHaveAttribute('data-asset-failures','0');
    const tree=(await trees(page)).find(t=>t.id==='tree_apple_2')!;
    expect(tree.height).toBeCloseTo(8.4,4);expect(tree.position).toEqual({x:14,z:1.5});
    await startFirstPerson(page);
    await info.attach('tree-adult-approach',{body:await page.screenshot(),contentType:'image/png'});
    const before=await player(page);
    try{
      await page.keyboard.down('KeyW');
      await waitForPlayerZBelow(page,tree.collider.maxZ+.43,20_000);
      await page.waitForTimeout(450);
    }finally{await page.keyboard.up('KeyW');}
    const contact=await player(page);
    expect(contact.x).toBeCloseTo(14,1);expect(before.z-contact.z).toBeGreaterThan(1.5);
    expect(contact.z).toBeGreaterThanOrEqual(tree.collider.maxZ+.3-.015);
    expect(contact.z).toBeLessThan(2.65);
    await lookForObject(page,'苹果树',0,.35);
    await info.attach('tree-trunk-contact-closeup',{body:await page.screenshot(),contentType:'image/png'});
    await page.keyboard.press('KeyE');await expect(page.locator('#interactionTitle')).toContainText('苹果树');
    await page.locator('#interactionActions button').nth(2).press('Enter');
    await expect(page.locator('#toast')).toContainText('木料 ×2');
    await expect.poll(async()=>{const s=await saved(request);return s.revision>revision&&s.snapshot?.meta.playerInventory.wood===2;},{timeout:45_000}).toBe(true);
    const accepted=await saved(request);const object=accepted.snapshot.homeObjects?.find(o=>o.id===tree.id);
    expect(object?.position).toEqual(tree.position);expect(object?.kind).toBe('tree');
    expect(object?.resourceAmount).toBe(3); // The normal first chop consumes one of the default four units.
    await info.attach('tree-contact-and-accepted-save',{body:Buffer.from(JSON.stringify({before,contact,tree,revision:accepted.revision,object,inventory:accepted.snapshot.meta.playerInventory},null,2)),contentType:'application/json'});
    await page.reload();
    await expect.poll(async()=>Number(await status(page).getAttribute('data-persistence-revision'))).toBeGreaterThanOrEqual(accepted.revision);
    await expect.poll(async()=>(await trees(page)).some(t=>t.id===tree.id&&!!t.collider),{timeout:45_000}).toBe(true);
    const reloaded=(await trees(page)).find(t=>t.id===tree.id)!;
    expect(reloaded.collider).toEqual(tree.collider);expect(reloaded.trigger).toEqual(tree.trigger);
    const restored=await saved(request);
    expect(restored.snapshot.meta.playerInventory.wood).toBe(2);
    expect(restored.snapshot.homeObjects?.find(o=>o.id===tree.id)?.resourceAmount).toBe(3);
    await startFirstPerson(page);await lookForObject(page,'苹果树',0,.35);
    await info.attach('tree-reloaded-trunk',{body:await page.screenshot(),contentType:'image/png'});
    expect(errors).toEqual([]);
  }catch(error){
    await info.attach('tree-failure-state',{body:Buffer.from(JSON.stringify({player:await player(page),trees:await trees(page),errors,prompt:await page.locator('#prompt').innerText()},null,2)),contentType:'application/json'});
    await info.attach('tree-failure-before-teardown',{body:await page.screenshot(),contentType:'image/png'});throw error;
  }finally{await page.keyboard.up('KeyW');}
});

test('rendered NPC soles remain supported through ordinary idle and moving simulation poses',async({page,request},info)=>{
  test.setTimeout(180_000);
  await seed(request,{x:-9,z:-7.5});
  await page.addInitScript(()=>localStorage.setItem('latticefolk.locale','en'));
  await page.goto('/',{waitUntil:'domcontentloaded'});await pauseWithUi(page);
  await expect.poll(async()=>(await soles(page)).length,{timeout:45_000}).toBeGreaterThanOrEqual(10);
  await startFirstPerson(page);
  // Decision pause does not freeze paths/animations. Track the nearest source actor
  // through ordinary relative-look input rather than photographing an empty fixed view.
  let heading=0;
  const frameActor=async()=>{
    const framed=await page.evaluate(async heading=>{
      const data=document.querySelector<HTMLElement>('#worldStatus')!.dataset;
      const origin={x:Number(data.playerX),z:Number(data.playerZ)};
      const actors=JSON.parse(data.characterSoles??'[]') as SoleView[];
      const actor=actors.sort((a,b)=>Math.hypot(a.position.x-origin.x,a.position.z-origin.z)-Math.hypot(b.position.x-origin.x,b.position.z-origin.z))[0];
      if(!actor)throw new Error('No current sourced actor to frame');
      const dx=actor.position.x-origin.x,dz=actor.position.z-origin.z,distance=Math.hypot(dx,dz);
      if(!(distance<12))throw new Error(`Source actor is out of framing range: ${distance}`);
      const nextHeading=Math.atan2(dx,-dz);
      const turn=Math.atan2(Math.sin(nextHeading-heading),Math.cos(nextHeading-heading));
      const pitch=Math.atan2(1.7-.9,distance),canvas=document.querySelector('#game canvas')!;
      const look=(x:number,y:number)=>{
        const event=new MouseEvent('mousemove',{bubbles:true});
        Object.defineProperties(event,{movementX:{value:x},movementY:{value:y}});
        canvas.dispatchEvent(event);
      };
      look(turn/.002,0);look(0,2000);look(0,(pitch-Math.PI/2)/.002);
      await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
      return {actor,origin,heading:nextHeading,pitch,distance};
    },heading);
    heading=framed.heading;
    expect(framed.actor).toBeTruthy();expect(framed.distance).toBeLessThan(12);
    return framed;
  };
  const pausedFraming=await frameActor();
  await info.attach('npc-decision-paused-support-context',{body:await page.screenshot(),contentType:'image/png'});
  const decisionPaused=await soles(page);
  for(const actor of decisionPaused){expect(actor.vertices).toBeGreaterThan(0);expect(Math.abs(actor.sole-actor.ground)).toBeLessThan(.001);}
  await page.keyboard.press('Tab');await page.locator('#pauseBtn').press('Enter');await page.keyboard.press('Tab');
  await expect.poll(async()=>(await soles(page)).some(a=>a.animation==='Walk'||a.animation==='Run'),{timeout:30_000}).toBe(true);
  const frames=await page.evaluate(async()=>{
    const samples:unknown[]=[];
    for(let frame=0;frame<48;frame++){
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      if(frame%4===0)samples.push(JSON.parse(document.querySelector<HTMLElement>('#worldStatus')!.dataset.characterSoles!));
    }
    return samples as SoleView[][];
  });
  expect(frames.flat().some(a=>a.animation==='Walk'||a.animation==='Run')).toBe(true);
  for(const actor of frames.flat())expect(Math.abs(actor.sole-actor.ground)).toBeLessThan(.001);
  const movingFraming=await frameActor();
  await info.attach('npc-current-skin-support-samples',{body:Buffer.from(JSON.stringify({decisionPaused,frames,pausedFraming,movingFraming},null,2)),contentType:'application/json'});
  await info.attach('npc-moving-pose-context',{body:await page.screenshot(),contentType:'image/png'});
});

test('native approach respects source head clearance while dialogue and observer shadows remain usable',async({page,request},info)=>{
  test.setTimeout(300_000);
  const revision=await seed(request,{x:-9,z:-7.5});
  // One read-only DOM snapshot per checkpoint avoids mixing frames and spending
  // the transient speech lifetime on repeated protocol round trips.
  const readView=()=>page.evaluate(()=>{
    const d=document.querySelector<HTMLElement>('#worldStatus')!.dataset;
    return {player:{x:Number(d.playerX),z:Number(d.playerZ)},mode:d.cameraMode,
      body:d.playerBodyPresent==='true',discovered:d.discoveredChunks,
      actors:JSON.parse(d.characterSoles??'[]') as (SoleView&{minimumPlayerSeparation:number;headYaw:number;headEnvelope:unknown;playerHeadClearance:number|null})[],
      buildings:JSON.parse(d.homeBuildingAnchors??'[]') as {id:string;center:{x:number;z:number};frontage:{x:number;z:number};blockedAtCenter:boolean;ownTrigger:boolean}[],
      shadow:JSON.parse(d.shadowView??'{}') as {mode:string;halfExtent:number;mapSize:number;focus:number[]}};
  });
  // Controlled bounded idle proposals isolate contact without deleting NPCs or stopping physics.
  // Dialogue, inventory/persistence, rendering and input continue through the actual application.
  await page.route('**/api/decision',async route=>{
    const input=route.request().postDataJSON();expect(input.allowedActions).toContain('idle');
    await route.fulfill({json:{source:'test-bounded-idle',action:'idle',stateShift:'stable',commitment:1,confidence:1,reasonCode:'contact-fixture'} satisfies DecisionResponse});
  });
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('latticefolk.locale','en'));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect.poll(async()=>(await soles(page)).length,{timeout:45_000}).toBeGreaterThanOrEqual(10);
  await startFirstPerson(page);
  const initial=await readView();
  const actor=initial.actors.find(a=>a.id==='ren')!;expect(actor.position).toEqual({x:-9,z:-11});
  const separation=actor.minimumPlayerSeparation;expect(separation).toBeCloseTo(1.05,8);
  expect(actor.headEnvelope).toEqual({minX:-1.30,maxX:1.35,minZ:-1.15,maxZ:.75});
  expect(actor.headYaw).toBe(0);
  const before=initial.player;
  expect(initial.buildings.length).toBe(12);
  const bakery=initial.buildings.find(b=>b.id==='building_面包房')!;
  expect(bakery.center).toEqual({x:-10,z:-18});expect(bakery.frontage).not.toEqual(bakery.center);
  for(const building of initial.buildings){expect(building.blockedAtCenter).toBe(true);expect(building.ownTrigger).toBe(true);}
  try{
    await page.keyboard.down('KeyW');
    await waitForPlayerZBelow(page,actor.position.z+separation+.25,20_000);
    await page.waitForTimeout(500);
  }finally{await page.keyboard.up('KeyW');}
  const contacted=await readView(),contact=contacted.player;
  expect(contact.x).toBeCloseTo(-9,3);
  expect(contact.z-actor.position.z).toBeGreaterThanOrEqual(separation-.0001);
  expect(before.z-contact.z).toBeGreaterThan(1.4);
  expect(contacted.actors.find(a=>a.id==='ren')!.position).toEqual(actor.position);
  expect(contacted.actors.find(a=>a.id==='ren')!.playerHeadClearance).toBeGreaterThanOrEqual(-.0001);
  await lookForObject(page,'莲',0,.22);
  await info.attach('npc-native-head-clearance',{body:await page.screenshot(),contentType:'image/png'});
  // Observe the rendered bubble atomically before E. Sequential CDP visibility and
  // boundingBox calls can outlive its real 9-second lifetime on software WebGL.
  const displayed=page.evaluate(()=>new Promise<{text:string;visible:boolean;x:number;y:number;width:number;height:number}>(resolve=>{
    const layer=document.querySelector('#speechLayer')!;
    const observe=()=>{
      for(const node of layer.querySelectorAll<HTMLElement>('.speech:not(.hidden)')){
        const bounds=node.getBoundingClientRect();
        if(!node.textContent||bounds.width===0||bounds.height===0)continue;
        observer.disconnect();
        resolve({text:node.textContent,visible:getComputedStyle(node).visibility!=='hidden',x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height});
        return;
      }
    };
    const observer=new MutationObserver(observe);
    observer.observe(layer,{subtree:true,childList:true,attributes:true,characterData:true});observe();
  }));
  const photograph=displayed.then(async observed=>({observed,image:await page.screenshot()}));
  const dialogue=page.waitForResponse(r=>r.url().endsWith('/api/dialogue')&&r.request().method()==='POST');
  await page.keyboard.press('KeyE');
  const [spoken,evidence]=await Promise.all([dialogue,photograph]);expect(spoken.ok()).toBe(true);
  const utterance=await spoken.json();expect(utterance.text.length).toBeGreaterThan(0);
  expect(evidence.observed.text).toBe(utterance.text);expect(evidence.observed.visible).toBe(true);
  expect(evidence.observed.y).toBeGreaterThanOrEqual(12);expect(evidence.observed.x).toBeGreaterThanOrEqual(12);
  expect(evidence.observed.x+evidence.observed.width).toBeLessThanOrEqual(1440-12);
  expect(evidence.observed.y+evidence.observed.height).toBeLessThanOrEqual(900-12);
  await info.attach('npc-visible-dialogue-at-contact',{body:evidence.image,contentType:'image/png'});
  await expect.poll(async()=>{const s=await saved(request);return s.revision>revision&&s.snapshot.homeNpcs?.some(n=>n.id==='ren'&&n.lastDialogue===utterance.text);},{timeout:45_000}).toBe(true);
  const accepted=await saved(request);
  const firstPerson=await readView(),firstShadow=firstPerson.shadow;
  expect(firstShadow.mode).toBe('firstPerson');expect(firstShadow.halfExtent).toBe(24);
  expect(firstPerson.body).toBe(true);
  const discovered=firstPerson.discovered;
  await page.keyboard.press('KeyG');
  let observerView=firstPerson;
  await expect.poll(async()=>{observerView=await readView();return [observerView.mode,observerView.body];}).toEqual(['god',false]);
  // Camera-only observer pan. Shadow focus may move but discovery/player state must not.
  const godBefore=observerView.shadow;
  try{await page.keyboard.down('KeyD');await page.waitForTimeout(800);}finally{await page.keyboard.up('KeyD');}
  const panned=await readView(),godAfter=panned.shadow;
  expect(godAfter.mode).toBe('god');expect(godAfter.mapSize).toBe(2048);
  expect(godAfter.halfExtent).toBeLessThanOrEqual(96);expect(godAfter.focus).not.toEqual(godBefore.focus);
  expect(panned.discovered).toBe(discovered);expect(panned.body).toBe(false);
  expect(panned.player).toEqual(contact);
  await info.attach('observer-shadow-context',{body:await page.screenshot(),contentType:'image/png'});
  await page.keyboard.press('KeyG');
  await expect.poll(async()=>{const view=await readView();return [view.mode,view.body];}).toEqual(['firstPerson',true]);
  await page.reload();
  await expect.poll(async()=>(await soles(page)).length,{timeout:45_000}).toBeGreaterThanOrEqual(10);
  await startFirstPerson(page);
  const reloaded=await readView(),restored=reloaded.player;
  expect(restored.x).toBeCloseTo(contact.x,3);expect(restored.z).toBeCloseTo(contact.z,3);
  expect(reloaded.actors.find(a=>a.id==='ren')!.minimumPlayerSeparation).toBe(separation);
  expect(reloaded.actors.find(a=>a.id==='ren')!.position).toEqual(actor.position);
  expect(reloaded.buildings).toEqual(initial.buildings); // Neither frontage nor body moves on reload.
  expect((await saved(request)).snapshot.homeNpcs?.find(n=>n.id==='ren')?.lastDialogue).toBe(utterance.text);
  await lookForObject(page,'莲',0,.22);
  await info.attach('npc-reloaded-contact-shadow',{body:await page.screenshot(),contentType:'image/png'});
  await info.attach('npc-contact-shadow-save-record',{body:Buffer.from(JSON.stringify({before,contact,restored,actor,firstShadow,godBefore,godAfter,acceptedRevision:accepted.revision,utterance,bubble:evidence.observed,buildingsBefore:initial.buildings,buildingsAfter:reloaded.buildings},null,2)),contentType:'application/json'});
  expect(errors).toEqual([]);
});

test('bounded NPC conversation reaches the stationary player without getting stuck outside its head clearance',async({page,request},info)=>{
  test.setTimeout(180_000);
  const revision=await seed(request,{x:-9,z:-7.5});
  let proposed=false;
  await page.route('**/api/decision',async route=>{
    const input=route.request().postDataJSON();
    const canTalk=input.npc.id==='ren'&&input.allowedActions.includes('talk')&&input.world.nearbyNpcs.some((n:{id:string})=>n.id==='player');
    if(canTalk&&!proposed){
      proposed=true;
      await route.fulfill({json:{source:'test-bounded-talk',action:'talk',targetNpcId:'player',socialIntent:'smalltalk',stateShift:'stable',commitment:1,confidence:1,reasonCode:'contact-talk'} satisfies DecisionResponse});
    }else await route.fulfill({json:{source:'test-bounded-idle',action:'idle',stateShift:'stable',commitment:1,confidence:1,reasonCode:'contact-idle'} satisfies DecisionResponse});
  });
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('latticefolk.locale','en'));
  // Observe the real server exchange; no direct action/position mutation or NPC removal.
  const dialogue=page.waitForResponse(r=>r.url().endsWith('/api/dialogue')&&r.request().method()==='POST'&&r.request().postDataJSON()?.speaker.id==='ren',{timeout:90_000});
  await page.goto('/',{waitUntil:'domcontentloaded'});await startFirstPerson(page);
  const response=await dialogue;expect(response.ok()).toBe(true);expect(proposed).toBe(true);
  const utterance=await response.json();expect(utterance.text.length).toBeGreaterThan(0);
  const view=await status(page).evaluate(el=>{
    const d=(el as HTMLElement).dataset;
    return {player:{x:Number(d.playerX),z:Number(d.playerZ)},actors:JSON.parse(d.characterSoles??'[]') as (SoleView&{minimumPlayerSeparation:number})[]};
  });
  expect(view.player).toEqual({x:-9,z:-7.5});
  const ren=view.actors.find(a=>a.id==='ren')!;
  const distance=Math.hypot(ren.position.x-view.player.x,ren.position.z-view.player.z);
  expect(ren.position.z+11).toBeGreaterThan(1.2);expect(distance).toBeLessThanOrEqual(2.2);
  expect(distance).toBeGreaterThanOrEqual(ren.minimumPlayerSeparation);
  await expect.poll(async()=>{const s=await saved(request);return s.revision>revision&&s.snapshot.homeNpcs?.some(n=>n.id==='ren'&&n.lastDialogue===utterance.text);},{timeout:45_000}).toBe(true);
  const accepted=await saved(request);
  await lookForObject(page,'莲',0,.22);
  await info.attach('npc-completed-player-approach',{body:await page.screenshot(),contentType:'image/png'});
  await info.attach('npc-autonomous-approach-save',{body:Buffer.from(JSON.stringify({view,distance,utterance,revision:accepted.revision,npc:accepted.snapshot.homeNpcs?.find(n=>n.id==='ren')},null,2)),contentType:'application/json'});
  expect(errors).toEqual([]);
});


test('sourced NPC clone unload returns GPU allocations while the shared actor stays visible',async({page},testInfo)=>{
 await page.route('**/__skeleton_lifetime.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body style="margin:0"><script type="module" src="/e2e/fixtures/owned-skeleton-lifetime.ts"></script></body></html>'}));
 await page.goto('/__skeleton_lifetime.html');
 const result=await page.evaluate(async()=>await (window as unknown as {skeletonLifetime:Promise<{coarse:ReturnType<typeof import('./fixtures/coarse-resource-lifetime.js').measureCoarseResourceLifetime>;baseline:{geometries:number;textures:number};cycles:Array<{allocated:{geometries:number;textures:number};released:{geometries:number;textures:number}}>;meshCycles:Array<{allocated:{geometries:number;textures:number};released:{geometries:number;textures:number}}>;control:{allocated:{geometries:number;textures:number};detached:{geometries:number;textures:number};disposed:{geometries:number;textures:number}};final:{geometries:number;textures:number};owned:number;triangles:number;pixelsIdentical:boolean}>}).skeletonLifetime);
 expect(result.owned).toBeGreaterThan(0);expect(result.triangles).toBeGreaterThan(0);expect(result.cycles).toHaveLength(8);
 for(const cycle of result.cycles){expect(cycle.allocated.textures).toBeGreaterThan(result.baseline.textures);expect(cycle.released).toEqual(result.baseline);}
 expect(result.meshCycles).toHaveLength(8);for(const cycle of result.meshCycles){expect(cycle.allocated.geometries).toBeGreaterThan(result.baseline.geometries);expect(cycle.released).toEqual(result.baseline);}
 expect(result.control.allocated.textures).toBeGreaterThan(result.baseline.textures);expect(result.control.detached).toEqual(result.control.allocated);expect(result.control.disposed).toEqual(result.baseline);
 expect(result.final).toEqual(result.baseline);expect(result.pixelsIdentical).toBe(true);
 const coarse=result.coarse;expect(coarse.cycles).toHaveLength(8);expect(coarse.baseline.geometries).toBe(coarse.homeChunks+1);
 for(const cycle of coarse.cycles){expect(cycle.refreshed).toEqual(coarse.baseline);expect(cycle.away.geometries).toBe(cycle.awayChunks+1);expect(cycle.away.textures).toBe(coarse.baseline.textures);expect(cycle.returned).toEqual(coarse.baseline);expect(cycle.homeIds).toEqual(coarse.homeIds);}
 expect(coarse.final).toEqual(coarse.baseline);expect(coarse.authoritativeUnchanged).toBe(true);expect(coarse.pixelsIdentical).toBe(true);expect(coarse.materialized).toBe(0);expect(coarse.triangles).toBeGreaterThan(0);
 await testInfo.attach('npc-skeleton-gpu-lifecycle',{body:Buffer.from(JSON.stringify(result,null,2)),contentType:'application/json'});
 await page.screenshot({path:testInfo.outputPath('shared-npc-after-unload.png')});
});
